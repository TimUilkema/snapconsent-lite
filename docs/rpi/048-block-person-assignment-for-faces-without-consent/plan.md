# Feature 048 Plan: Block Person Assignment for Faces Without Consent

## Inputs and ground truth

This plan is based on:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- verified research in `docs/rpi/048-block-person-assignment-for-faces-without-consent/research.md`

Targeted live verification for planning was limited to:

- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/manual-asset-faces.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/project-export/project-export.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/manual-faces/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260409110000_045_asset_face_hidden_states.sql`
- `supabase/migrations/20260414110000_047_manual_asset_faces.sql`
- `tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`
- `tests/feature-047-manual-face-box-creation-in-asset-preview.test.ts`

## Verified current boundary

The current live boundary is:

- Current exact face identity is `asset_face_materialization_faces.id` and already supports detector and manual faces.
- `preview-faces` currently derives `faceState` as `linked_manual`, `linked_auto`, `unlinked`, or `hidden`.
- Hidden state is a separate auditable table and is already materialization-scoped.
- `manualLinkPhotoToConsent(...)` is the canonical exact-face write path for manual assignment and replacement.
- `manualUnlinkPhotoFromConsent(...)` is the canonical manual unlink path.
- `hideAssetFace(...)` already removes a current exact link, writes hidden state, and reruns reconcile only when it displaced an auto link.
- `reconcilePhotoFaceCanonicalStateForAsset(...)` already excludes hidden faces and non-detector faces from auto assignment.
- Manual faces already reuse the same preview, candidate, hide, and link flows as detector faces.
- Export currently serializes real exact face links and zero-face fallback links only. There is no blocked-face export state.

## Options considered

### Option A: Model Block as a fake consent row

Rejected.

Why:

- it corrupts consent semantics
- it would leak into consent-centric UI and exports as if a consent existed
- it wrongly mixes blocked/no-consent with structured scope-bearing consent records

### Option B: Add a dedicated exact-face blocked-state table

Chosen.

Why:

- it matches the existing pattern used for hidden-face state
- it preserves `asset_face_id` as the identity
- it keeps Block operator-owned and independent from real consents
- it is additive and leaves room for future export or DAM propagation

### Option C: Redesign face state into a generic merged state model

Rejected for v1.

Why:

- it is broader than this feature needs
- it would force wider refactoring across preview and linking helpers
- current code already uses separate tables for different operator-owned states

## Recommendation

Implement Feature 048 as a dedicated exact-face blocked-state extension.

The feature should:

- add a face-level blocked state independent from real consents
- keep blocked and hidden explicitly distinct
- support detected faces and manually drawn faces
- allow blocking linked and unlinked exact faces
- allow clearing blocked state
- allow manually assigning a real consent to a blocked face by clearing the block first inside the server-side link flow

It should not:

- create fake consent rows
- change zero-face fallback behavior
- redesign export output
- redesign hidden-face architecture

## Chosen architecture

### Architecture summary

Feature 048 will:

- keep the current `asset_face_id` identity model
- add a new materialization-scoped face state table for blocked faces
- add server helpers parallel to hidden-face helpers
- extend the preview read model with `faceState = 'blocked'`
- keep the current face candidate list real-consent-only
- expose `Block person` as an explicit face action, not a candidate row
- reuse the current manual consent-link write flow after clearing blocked state server-side

### Exact v1 scope boundary

Included:

- exact-face blocked state only
- detected faces
- manual faces created through Feature 047
- blocking an unlinked face
- blocking an auto-linked face
- blocking a manually linked face
- clearing blocked state
- preview rendering and actions for blocked faces
- server-side clearing of blocked state before manual link to a real consent

Excluded:

- zero-face fallback or `Link to entire asset`
- asset-level blocked assignment
- export or DAM output changes
- hidden-face redesign
- consent-template or scope-model redesign
- generic publishing-policy engine

### Exact v1 decisions

- Block applies to exact faces only.
- Block is operator-owned manual state only.
- Hidden and blocked are mutually exclusive active states.
- Blocked faces remain visible in normal preview mode.
- Block is shown as an explicit action on the selected face.
- Block is not shown as a fake person in candidate results.
- Clearing a block returns the face to normal unlinked state unless a manual link is applied in the same operation.

## Exact schema and model plan

### New table: `public.asset_face_block_states`

Chosen columns:

- `id uuid primary key default gen_random_uuid()`
- `asset_face_id uuid not null references public.asset_face_materialization_faces(id) on delete cascade`
- `asset_materialization_id uuid not null references public.asset_face_materializations(id) on delete cascade`
- `asset_id uuid not null`
- `tenant_id uuid not null references public.tenants(id) on delete restrict`
- `project_id uuid not null`
- `reason text not null default 'no_consent'`
- `blocked_at timestamptz not null default now()`
- `blocked_by uuid null references auth.users(id) on delete set null`
- `cleared_at timestamptz null`
- `cleared_by uuid null references auth.users(id) on delete set null`

Chosen constraints and indexes:

- foreign key `(asset_id, tenant_id, project_id)` to `assets`
- check `reason in ('no_consent')`
- partial unique index on `(asset_face_id)` where `cleared_at is null`
- index on `(tenant_id, project_id, asset_id, cleared_at, blocked_at desc)`
- index on `(tenant_id, project_id, asset_materialization_id, cleared_at)`

### Exact model decisions

- The blocked state is materialization-scoped, like hidden-face state.
- The face identity remains `asset_face_id`.
- V1 reason is enum-only with one allowed value: `no_consent`.
- No free-text note is added in v1.
- Block history is preserved by clearing rows instead of deleting them.

### Cleanup and stale-row behavior

- Active blocked rows are only valid for the current `asset_materialization_id`.
- Add load helpers parallel to hidden-face helpers:
  - load active blocked rows
  - mark stale blocked rows inactive by setting `cleared_at` and `cleared_by = null`
- Do not attempt cross-rematerialization remap.

## Exact semantics for blocking and clearing

### Blocking an unlinked face

Behavior:

1. Validate tenant, project, asset, and current materialization.
2. Validate the face exists in the current materialization.
3. Reject if the face is currently hidden.
4. Insert active blocked-face state.
5. Do not create a consent suppression because no consent was displaced.
6. Do not run reconcile.

Result:

- face becomes `blocked`
- face remains visible
- face is not auto-linkable while blocked

### Blocking an auto-linked face

Behavior:

1. Validate current face and ensure it is not hidden.
2. Remove the current exact face link first.
3. Upsert a face suppression for the displaced consent on that face with `reason = 'manual_replace'`.
4. Insert active blocked-face state.
5. Run reconcile after the write because an auto link was displaced.

Result:

- the face becomes blocked
- the displaced consent is suppressed from immediately reclaiming that face
- auto reconciliation can rebalance remaining detector faces, but not the blocked face

### Blocking a manually linked face

Behavior:

1. Validate current face and ensure it is not hidden.
2. Remove the current exact face link first.
3. Upsert a face suppression for the displaced consent on that face with `reason = 'manual_replace'`.
4. Insert active blocked-face state.
5. Do not run reconcile just because a manual link was displaced.

Result:

- the face becomes blocked
- the prior consent is suppressed from reoccupying that face automatically

### Clearing blocked state

Behavior:

1. Validate current face and current materialization.
2. Update the active blocked row for the face by setting `cleared_at` and `cleared_by`.
3. Do not recreate any prior consent link.
4. Do not auto-hide the face.
5. Do not automatically run reconcile in v1.

Result:

- the face becomes normal unlinked current face
- the operator can then link a real consent explicitly

### Assigning a real consent after blocked state existed

Behavior:

1. Keep using `POST /api/projects/[projectId]/consents/[consentId]/assets/links`.
2. In `manualLinkPhotoToConsent(...)`, if the selected face has an active blocked row, clear it first.
3. Continue through the existing manual link and replacement logic.
4. On successful link, the face ends in `linked_manual`.

Result:

- blocked-to-real-consent transition reuses the existing exact-face link path
- no separate special-case UI write route is needed for "replace block with consent"

## Exact preview and read-path plan

### Preview model changes

Extend `AssetPreviewFacesResponse.faces[]` with:

- `faceState: "linked_manual" | "linked_auto" | "unlinked" | "hidden" | "blocked"`
- `blockedAt: string | null`
- `blockedReason: "no_consent" | null`

Derived precedence for preview state:

1. `hidden`
2. `blocked`
3. `linked_manual`
4. `linked_auto`
5. `unlinked`

This precedence relies on the mutual-exclusivity invariant that hidden and blocked cannot both be active.

### `preview-faces` helper changes

`getAssetPreviewFaces(...)` should:

- load active blocked-face rows in parallel with hidden rows and overlays
- mark stale blocked rows inactive the same way hidden rows are handled
- derive blocked face state for current faces
- continue returning blocked faces in the normal visible face list

### Candidate route changes

`getAssetPreviewFaceCandidates(...)` should:

- continue rejecting hidden faces with `hidden_face_restore_required`
- allow blocked faces to fetch candidates
- remain consent-only; it does not need to return a fake Block candidate

### Preview rendering changes

Blocked faces should:

- remain visible in normal preview mode
- render with distinct blocked styling and label
- not appear in the hidden-face tray
- not appear in the linked-consent side panel because they do not have `currentLink`

### Preview actions on blocked faces

Blocked face actions in v1:

- `Assign person`
- `Clear block`

Blocked faces should not offer direct `Hide face` until the block is cleared. This keeps the semantics explicit.

### Smallest UI shape

Use the existing selected-face architecture with additive branches:

- unlinked face tray:
  - add `Block person`
- linked face side panel:
  - add `Block person` beside current face actions
- blocked face tray:
  - new below-scene tray for selected blocked face
  - show blocked state copy
  - allow `Assign person`
  - allow `Clear block`

This is smaller than redesigning the consent side panel around non-consent states.

## Exact write and API plan

### New route surface

Add dedicated exact-face block routes:

- `POST /api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]`
- `DELETE /api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]`

This mirrors the existing hidden-face route shape and keeps the capability exact-face-specific.

### New server helpers

Add helpers in `src/lib/matching/photo-face-linking.ts`:

- `blockAssetFace(...)`
- `clearBlockedAssetFace(...)`

Add supporting helpers parallel to hidden-face state helpers:

- `loadActiveBlockedFaceRowsForAssets(...)`
- `loadCurrentBlockedFacesForAssets(...)`
- `loadCurrentBlockedFacesForAsset(...)`
- `markBlockedFaceRowsInactive(...)`
- `clearBlockedFaceStateForFace(...)`

### Server-side validation rules

Both block and clear routes must:

- require authenticated project access
- derive tenant id server-side
- validate asset belongs to project and tenant
- validate `assetFaceId` belongs to the current materialization for that asset
- never trust client-provided tenant information

### Manual link flow reuse

`manualLinkPhotoToConsent(...)` should be extended to:

- tolerate the selected face being blocked
- clear the block on the target face before upserting the manual link
- keep all other current face replacement semantics intact

No new consent-link route is needed.

## Reconciliation and precedence plan

Blocked faces must behave as operator-owned occupied face state.

### Exact rules

- Blocked faces are not eligible for auto assignment.
- Auto reconciliation must exclude blocked faces, just as it already excludes hidden and non-detector faces.
- Blocked faces must not receive new auto links while blocked.
- Blocking a linked face must preserve suppressions against the displaced consent on that face.
- Manual over auto precedence remains unchanged. Blocked state is operator-owned and outranks auto behavior.

### Reconcile helper changes

`reconcilePhotoFaceCanonicalStateForAsset(...)` should:

- load active blocked face ids for the current asset
- exclude blocked face ids from contender selection
- exclude blocked face ids from desired auto rows
- keep blocked detector faces visible in the face list, but not auto-eligible

### Candidate generation implications

- Blocked faces remain candidate-eligible for manual operator assignment.
- Hidden faces remain ineligible until restored.
- Manual faces remain excluded from auto compare and auto reconcile as today.

## Hidden versus blocked interaction

Mutual exclusivity is explicit.

### Hidden -> blocked

- Not allowed directly.
- Attempting to block a hidden face returns `409 hidden_face_restore_required`.
- Operator must restore first, then block.

### Blocked -> hidden

- Not allowed directly.
- Attempting to hide a blocked face returns `409 blocked_face_clear_required`.
- Operator must clear the block first, then hide if the face is actually irrelevant.

### Clear versus restore semantics

- Hidden state uses restore semantics.
- Blocked state uses clear semantics.
- Restoring a hidden face returns it to unlinked.
- Clearing a blocked face returns it to unlinked.

This preserves the semantic difference:

- hidden = ignore this face
- blocked = relevant face present and prevents publishing

## Future export and DAM enablement boundary

No export or DAM redesign is in scope for Feature 048.

The chosen model leaves room for later propagation because it persists:

- exact face id
- asset id
- materialization id
- tenant and project scope
- active blocked state
- reason
- actor
- timestamp

Later systems will be able to derive:

- this specific face is blocked
- this asset contains blocked content if any active blocked face exists

No export JSON changes are planned in this feature.

## Security and reliability considerations

### Security model

- same protected model as current face mutation routes
- authenticated user required
- tenant id resolved server-side from membership
- project and asset scope validated server-side
- current materialization face ownership validated server-side
- no client authority over tenant or project scoping

### Reliability and retry behavior

- block writes should be idempotent
- repeated block on the same active face should return `already_blocked` behavior, not duplicate rows
- repeated clear on an already-cleared face should return `already_cleared`
- unique active-row index on `asset_face_id` protects duplicate active blocks
- linked-face block writes should remain safe under retries by using deterministic delete plus upsert flow

### Partial-failure expectations

- if link removal succeeds but block insert fails, the request should return an error and no hidden semantics should be implied
- implementation should keep writes compact and ordered to minimize partial-state windows
- later implementation should consider using one transaction boundary if the helper surface already supports it cleanly

## Edge cases

- Blocking an unlinked detected face creates active blocked state and leaves no consent mutation.
- Blocking an auto-linked face removes the auto link, writes `manual_replace` suppression for the displaced consent, writes block state, and reruns reconcile.
- Blocking a manually linked face removes the manual link, writes `manual_replace` suppression for the displaced consent, and writes block state.
- Blocking a manually drawn face works the same as any other exact face.
- Clearing blocked state returns the face to unlinked and visible.
- Assigning a real consent to a blocked face clears the block first inside the manual-link helper.
- Multiple blocked faces on one asset are allowed.
- Assets can contain both consented and blocked faces at the same time.
- Hidden and blocked cannot both be active on the same face.
- One blocked face is enough for future downstream logic to consider the asset blocked for publishing, but no downstream implementation is included here.

## Test plan

### Schema and model tests

- migration creates `asset_face_block_states` with expected constraints and indexes
- reason check rejects invalid values
- one active blocked row per face is enforced
- cleared rows allow later re-block of the same face

### Helper and write-path tests

- blocking an unlinked face creates active blocked state
- blocking an auto-linked face removes the link and writes `manual_replace` suppression
- blocking a manually linked face removes the link and writes `manual_replace` suppression
- repeated block is idempotent
- clear blocked state marks the row inactive
- manual link to a blocked face clears the block first and succeeds

### Preview and read-model tests

- `preview-faces` returns blocked faces with `faceState = 'blocked'`
- blocked faces remain visible when hidden faces are filtered out
- blocked faces are not returned as hidden
- blocked faces do not populate `currentLink`

### Reconciliation tests

- blocked detector faces are excluded from auto assignment
- blocking a currently auto-linked face prevents that face from being auto-relinked
- manual faces remain excluded from auto reconcile even when blocked state exists elsewhere

### Hidden-versus-blocked tests

- blocking a hidden face returns `hidden_face_restore_required`
- hiding a blocked face returns `blocked_face_clear_required`
- restore and clear remain distinct and do not recreate prior links

### Security and scope tests

- tenant and project scoping are enforced for block and clear routes
- invalid `assetFaceId` outside the current materialization is rejected
- unauthenticated and no-membership requests fail consistently

### Manual-face compatibility tests

- manually created faces can be blocked
- blocked manual faces survive preview refresh correctly
- manual link after blocked manual face clears the block and links successfully

## Implementation phases

### Phase 1: Schema and server helpers

- add `asset_face_block_states` migration with RLS, policies, indexes, and constraints
- add blocked-state load, cleanup, block, and clear helpers
- extend shared face-state resolution helpers with blocked-face awareness

### Phase 2: Reconciliation and write-flow integration

- exclude blocked faces from auto reconcile
- update manual link helper to clear block before linking
- update hide helper to reject blocked faces with explicit conflict
- add targeted helper tests

### Phase 3: Read-model and route surface

- extend `preview-faces` with blocked state fields
- keep `preview-candidates` blocked-compatible
- add `blocked-faces` POST and DELETE routes

### Phase 4: Preview UI

- add blocked face state styling and labels
- add `Block person` action for unlinked tray and linked side panel
- add blocked face tray with `Assign person` and `Clear block`
- keep candidate picker consent-only

### Phase 5: Tests and polish

- add integration coverage for linked and unlinked block flows
- add hidden-versus-blocked conflict coverage
- add manual-face compatibility coverage
- verify preview refresh and selected-face behavior after block and clear

## Scope boundaries

Explicitly out of scope:

- fake consent modeling for Block
- export or DAM output redesign
- zero-face fallback redesign
- hidden-face redesign beyond mutual-exclusion enforcement
- consent/template redesign
- generic publishing-policy engine
- asset-level assignment or block workflows

## Future asset-level compatibility

This feature remains exact-face-only, but the chosen model leaves room for later asset-level assignment work.

Compatibility notes:

- `asset_face_block_states` is explicitly face-scoped, which leaves room for a separate future asset-level table if needed.
- `blocked-faces` route naming is exact-face-specific and does not preclude later asset-level routes such as:
  - `asset-links`
  - `asset-block-states`
- The preview and helper naming should avoid implying that all blocking must always be face-based.
- A later asset-level mode such as `Link person to entire asset` or asset-level blocked/no-consent state can coexist alongside exact-face blocked state without overloading this model.

## Concise implementation prompt

Implement Feature 048 as a bounded additive exact-face blocked-state feature. Add a new materialization-scoped `asset_face_block_states` table with active-row uniqueness on `asset_face_id`, reason `no_consent`, and clear history fields. Add `blockAssetFace(...)` and `clearBlockedAssetFace(...)` helpers plus `POST/DELETE /api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]` routes using the same tenant-scoped protected model as current face mutation routes. Extend `preview-faces` to return `faceState = 'blocked'` plus minimal block metadata, keep `preview-candidates` consent-only, and update `ProjectAssetPreviewLightbox` so unlinked and linked faces expose a `Block person` action while selected blocked faces show a dedicated tray with `Assign person` and `Clear block`. Blocking a linked face must remove the current link first, write `manual_replace` suppression for the displaced consent on that face, then persist blocked state. Manual linking to a blocked face must clear the block first and then reuse the existing manual-link path. Hidden and blocked must remain mutually exclusive, with explicit `hidden_face_restore_required` and `blocked_face_clear_required` conflicts. Exclude blocked faces from auto reconciliation and add focused tests for schema, preview read state, linked and unlinked block flows, mutual exclusivity, tenant scope, and manual-face compatibility.
