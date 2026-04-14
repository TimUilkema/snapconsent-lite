# Feature 048 Research: Block Person Assignment for Faces Without Consent

## Goal

Research how to let an operator mark a detected or manually drawn face as a standard blocked person assignment when no consent form exists and the asset must be treated as blocked for publishing.

This research is code-first. Current repository code and schema are the source of truth. The feature must stay bounded, reuse the current exact-face model and asset preview flows where possible, preserve server-side tenant-scoped business logic, and keep hidden-face semantics distinct from blocked-face semantics.

## Inputs reviewed

Requested docs, in order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/031-one-consent-per-face-precedence-rules/research.md`
- `docs/rpi/031-one-consent-per-face-precedence-rules/plan.md`
- `docs/rpi/032-face-consent-linking-ui-improvements/research.md`
- `docs/rpi/032-face-consent-linking-ui-improvements/plan.md`
- `docs/rpi/033-asset-face-overlays-and-confidence/research.md`
- `docs/rpi/033-asset-face-overlays-and-confidence/plan.md`
- `docs/rpi/042-structured-consent-template-fields/research.md`
- `docs/rpi/042-structured-consent-template-fields/plan.md`
- `docs/rpi/044-asset-preview-linking-ux-improvements/research.md`
- `docs/rpi/044-asset-preview-linking-ux-improvements/plan.md`
- `docs/rpi/045-asset-preview-unlinked-faces-and-hidden-face-suppression/research.md`
- `docs/rpi/045-asset-preview-unlinked-faces-and-hidden-face-suppression/plan.md`
- `docs/rpi/047-manual-face-box-creation-in-asset-preview/research.md`
- `docs/rpi/047-manual-face-box-creation-in-asset-preview/plan.md`

`<NEXT_ID>` resolves to `048` because `docs/rpi/047-manual-face-box-creation-in-asset-preview/` is the highest existing numbered folder.

Live implementation verified directly:

- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/components/projects/assets-list.tsx`
- `src/lib/client/face-overlay.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/manual-asset-faces.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/templates/structured-fields.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/project-export/project-export.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/manual-faces/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state/route.ts`
- `src/app/api/projects/[projectId]/export/route.ts`
- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260407213000_042_structured_consent_template_fields.sql`
- `supabase/migrations/20260409110000_045_asset_face_hidden_states.sql`
- `supabase/migrations/20260414110000_047_manual_asset_faces.sql`
- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
- `tests/feature-042-structured-consent-template-fields.test.ts`
- `tests/feature-043-simple-project-export-zip.test.ts`
- `tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`
- `tests/feature-047-manual-face-box-creation-in-asset-preview.test.ts`

## Verified current behavior

- There is no current first-class blocked-face assignment in schema, routes, preview state, or export output.
- Current exact face identity everywhere is `asset_face_materialization_faces.id`.
- Current asset preview face state is derived, not stored as one enum in the database. The live preview returns `linked_manual`, `linked_auto`, `unlinked`, and `hidden`.
- Real consent assignment is represented only by `asset_face_consent_links`.
- Hidden-face state is represented separately by `asset_face_hidden_states`.
- Unlinked face state is implicit: a current face row exists with no current link and no active hidden row.
- Manual faces are current `asset_face_materialization_faces` rows with `face_source = 'manual'`, not a separate face identity model.
- Hidden faces are excluded from active linking, candidate use, overlay summaries, and auto reconciliation, but they still exist and can be restored.
- Auto reconciliation only considers detector faces. Manual faces are intentionally excluded from compare-driven auto assignment.
- Manual link and replace behavior already enforces manual over auto precedence and one-face-per-consent-per-asset invariants.
- Project export currently knows only face links and zero-face fallbacks. It has no representation for "relevant face present but no consent, therefore blocked."

## Current schema, routes, and components involved

### Canonical face and assignment tables

- `asset_face_materializations`
- `asset_face_materialization_faces`
- `asset_face_consent_links`
- `asset_face_consent_link_suppressions`
- `asset_face_hidden_states`
- `asset_consent_manual_photo_fallbacks`
- `asset_consent_manual_photo_fallback_suppressions`

### Current face-related routes

- `GET /api/projects/[projectId]/assets/[assetId]/preview-faces`
- `GET /api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates`
- `POST /api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]`
- `DELETE /api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]`
- `POST /api/projects/[projectId]/assets/[assetId]/manual-faces`
- `POST /api/projects/[projectId]/consents/[consentId]/assets/links`
- `DELETE /api/projects/[projectId]/consents/[consentId]/assets/links`

### Current preview and linking code paths

- `getAssetPreviewFaces(...)` and `getAssetPreviewFaceCandidates(...)` in `src/lib/matching/asset-preview-linking.ts`
- `manualLinkPhotoToConsent(...)`, `manualUnlinkPhotoFromConsent(...)`, `hideAssetFace(...)`, `restoreHiddenAssetFace(...)`, and `reconcilePhotoFaceCanonicalStateForAsset(...)` in `src/lib/matching/photo-face-linking.ts`
- `createManualAssetFace(...)` in `src/lib/matching/manual-asset-faces.ts`
- `ensureAssetFaceMaterialization(...)` in `src/lib/matching/face-materialization.ts`
- `ProjectAssetPreviewLightbox` in `src/components/projects/project-asset-preview-lightbox.tsx`

## Current constraints and invariants

- Face identity must remain `asset_face_materialization_faces.id`.
- Current preview UX assumes face state is derived from active exact-face state, not from free-form client data.
- Hidden state is already a first-class table and has different semantics from unlinking.
- Manual faces survive rematerialization by preserving `face_source = 'manual'` rows in `ensureAssetFaceMaterialization(...)`.
- `asset_face_consent_links` enforces one face per consent and one consent per face on an asset.
- Manual write paths are server-side, tenant-scoped, and project-scoped. The client never provides tenant id.
- Auto matching is detector-face only and already respects manual ownership and suppressions.
- Structured scope selections live on real signed consents via `consents.structured_fields_snapshot`, not on assets or faces directly.
- Export currently serializes only real consent links and fallback links, so any later blocked-face propagation needs an explicit additive state.

## 1. Current exact-face assignment model

Current live face states are not stored as one generalized `assignment_state` column. They are composed from separate tables and current materialization membership:

- Real consent link:
  - table: `asset_face_consent_links`
  - one active row per face
  - one consent can occupy only one face on the same asset
  - `link_source` is `manual` or `auto`
- Hidden face:
  - table: `asset_face_hidden_states`
  - one active row per face where `restored_at is null`
  - reason is currently only `manual_hide`
- Unlinked face:
  - represented by absence
  - current face exists, with no active row in `asset_face_consent_links` and no active row in `asset_face_hidden_states`
- Manual face creation:
  - table: `asset_face_materialization_faces`
  - manual faces use `face_source = 'manual'`
  - they reuse the same face id, overlay geometry, hidden state, and exact-linking model as detector faces

Bounded conclusion:

- The current model already supports multiple exact-face states, but only two are explicit persistent state tables: real links and hidden faces.
- "Blocked" does not exist today and cannot be represented without either misusing consent rows or adding additive blocked-face persistence.

## 2. Hidden face versus blocked face

The current code strongly supports keeping these as distinct semantics:

- Hidden face means "ignore this face."
  - current examples: false positive, irrelevant tiny background face, operator suppression of a non-person or unusable detection
  - implementation effect today: face is excluded from active preview summaries, linking, and auto reconciliation
- Blocked face means "this face matters and prevents publishing."
  - intended example: a real person is present, no consent exists, and the asset must not be treated as publishable
  - desired implementation effect: face stays relevant in preview and downstream interpretation, but is not linked to a real consent

Recommendation:

- Keep hidden and blocked explicit and separate in both model and UI.
- Do not overload `asset_face_hidden_states.reason`.
- Do not treat blocked as a flavor of unlinked.
- Do not allow a face to be actively hidden and actively blocked at the same time. Restoring should be required before blocking, and blocking should be cleared before hiding if the product allows that path later.

## 3. Option analysis for modeling Block

### Option A: Create a special fake or system consent row and reuse current linking semantics

Fit with current exact-face helpers and routes:

- Superficially good because existing link routes already attach a consent id to a face.
- Candidate and right-panel UI could technically treat it as another person row.

Problems:

- `public.consents` represents signed consent artifacts with real `subject_id`, `invite_id`, `consent_text`, `consent_version`, `signed_at`, revocation state, and now `structured_fields_snapshot`.
- A fake blocked consent would incorrectly look like a consented person in project pages, exports, matching lists, and any consent-scoped reporting.
- It would conflate "no consent exists" with "a consent record exists but disallows everything."
- It would pollute structured scope semantics by implying a scope-bearing consent snapshot where none exists.
- It would make future DAM/export consumers treat blocked faces as linked consents unless every downstream read is special-cased.

Conclusion:

- Reject. It corrupts consent semantics even if it seems convenient for reuse.

### Option B: Create a separate exact-face blocked assignment model independent from real consents

Fit with current exact-face helpers and routes:

- Good fit. Current live model already uses separate additive tables for hidden state and suppressions rather than overloading face rows.
- A dedicated blocked-face table can reuse `asset_face_id` as the identity and preserve the current exact-face model.
- Preview can expose a new derived state like `blocked` beside `linked_manual`, `linked_auto`, `unlinked`, and `hidden`.

Fit with current preview UI:

- Good fit if Block is presented as an explicit action on the selected face, not as a fake consent candidate.
- Works for detected faces and manual faces because both already share the same `assetFaceId`.

Fit with hidden-face logic:

- Good fit if hidden and blocked remain mutually exclusive active states.
- Similar to hidden state, an active blocked row can be additive and auditable.

Fit with export and DAM direction:

- Good fit because it creates a face-level no-consent signal that later export can serialize explicitly without pretending a consent exists.
- Future asset-level "blocked for publishing" can be derived from any active blocked face on the asset.

Risks:

- Requires additive schema, read-model, and route work.
- Auto reconciliation must be taught that blocked faces are operator-owned and not eligible for auto assignment.

Conclusion:

- Best fit.

### Option C: Another bounded additive approach, such as a generic face assignment state enum or merged face-state table

Possible shapes:

- add `assignment_state` directly to `asset_face_materialization_faces`
- create one generic `asset_face_assignment_states` table that merges hidden, blocked, and maybe future states

Fit:

- This could work technically, but it is a larger conceptual redesign than this feature needs.
- Current code already has separate tables for links, suppressions, and hidden state. Introducing a generic assignment abstraction now would force broader refactoring for little immediate value.

Problems:

- A face-row enum does not naturally model audit history, restore behavior, actor metadata, or replacement transitions as cleanly as the current separate-state pattern.
- A generic state table risks reopening the hidden-versus-blocked distinction that the current code has already made explicit.

Conclusion:

- Not recommended for this bounded feature. It is more redesign than additive extension.

## 4. Recommended bounded direction

Recommend Option B with a dedicated active blocked-face table, for example `asset_face_block_states`.

Recommended characteristics:

- keyed by `asset_face_id` and current materialization scope, like hidden state
- additive and auditable, not a fake consent
- manual operator-owned state only
- mutually exclusive with active hidden state and active exact consent link on the same face
- exposed in preview as a new derived face state such as `blocked`

Recommended minimum semantics:

- Block means "relevant person present, no consent exists, deny publishing for all scopes."
- Block is not a consent and should not carry structured consent fields.
- Block should not appear as a normal consent/person candidate row.
- Block should be selectable on:
  - unlinked detected faces
  - linked detected faces
  - unlinked manual faces
  - linked manual faces
- Hidden faces should require restore before block.

## 5. Current preview and linking UX fit

Current preview already has one selected-face panel and one candidate tray for real consents. The smallest v1 surface is:

- keep the candidate picker for real consents only
- add an explicit `Block person` action in the selected-face panel
- when a face is blocked, show a blocked badge/state in the same panel and overlay styling
- allow `Assign consent` or `Change person` from blocked state by clearing the block and then reusing the existing manual-link flow

Recommendation:

- Do not put Block inside the ranked candidate list as if it were a real consent.
- Do place Block in the same selected-face interaction area where operators already link, change, hide, or restore faces.
- Reuse the same entry point for detected and manual faces because they already share the same exact-face model.

Why this fits current code:

- `ProjectAssetPreviewLightbox` already branches on selected `faceState`.
- Current candidate loading already assumes consent-shaped rows from `preview-candidates`.
- Adding Block as a separate action avoids bending candidate APIs around a non-consent entity.

## 6. Current linking semantics and precedence

Current code already has replace semantics that remove the current face link, upsert suppressions, and preserve manual precedence. Block should reuse that model where practical.

Recommended behavior:

- If Block is assigned to an auto-linked face:
  - remove the current face link
  - record the blocked-face state as operator-owned
  - reuse suppression or equivalent replacement semantics so the same consent is not immediately re-auto-linked to that face
  - treat the blocked face as ineligible for auto assignment while blocked
- If Block is assigned to a manually linked face:
  - same replacement behavior as above
  - current manual link is displaced by an explicit operator action
- If Block is assigned to an unlinked detected face:
  - insert blocked-face state directly
- If Block is assigned to an unlinked manual face:
  - insert blocked-face state directly
- If a blocked face is later assigned a real consent:
  - clear the active blocked-face state first
  - then reuse existing `manualLinkPhotoToConsent(...)` flow

Recommendation:

- Block should always be manual/operator-owned state.
- Auto systems should never create or clear block state.
- Manual over auto precedence should continue to hold: blocked faces should behave as operator-owned face occupancy for reconciliation purposes.

## 7. Current candidate and face flows

Smallest v1 UX surface:

- unlinked detected face:
  - keep ranked candidate tray for linking
  - add explicit `Block person` action
- linked face right-side panel:
  - add `Block person` as a replacement action beside or near `Change person`
- manually drawn face:
  - after creation, it already becomes a normal current face
  - same panel actions can apply without a separate block-specific flow

Bounded conclusion:

- No new global picker is needed.
- No new "blocked person directory" is needed.
- No redesign of the preview layout is needed.

## 8. Data needed later for DAM or export propagation

Future downstream systems need to know at minimum:

- this exact face is blocked
- the block is active
- the asset therefore contains blocked publishing content if any active blocked face exists

Recommended minimum persisted data:

- `asset_face_id`
- `asset_materialization_id`
- `asset_id`
- `tenant_id`
- `project_id`
- `reason` with a bounded enum such as `no_consent`
- actor and timestamp fields such as `blocked_by` and `blocked_at`

Optional data to defer unless clearly needed:

- free-text operator note
- per-scope block settings
- subject identity metadata

Recommendation:

- "Blocked for all publishing scopes" is enough for v1.
- Keep scope semantics out of the blocked-face row.
- Later export can either emit blocked state per face in `detectedFaces` or add a dedicated blocked-face collection, but that downstream shape should be planned later, not designed in this feature.

## 9. Interaction with structured consent scopes

Real consents now carry structured field snapshots, including allowed publishing scopes, through `consents.structured_fields_snapshot`.

Block should interact conceptually as follows:

- real consent:
  - evaluate allowed scopes from the real signed consent snapshot
- blocked face:
  - no consent exists
  - deny all publishing scopes
- hidden face:
  - ignore the face for publishing interpretation

Recommendation:

- Do not treat Block as "a consent with no scopes checked."
- Do not encode Block inside `structured_fields_snapshot`.
- Downstream publishing logic must be able to distinguish:
  - scoped consented face
  - blocked no-consent face
  - hidden irrelevant face

## 10. Schema and migration implications

This feature should not use no-schema changes if Block is meant to be a first-class persistent assignment.

Recommendation:

- Use additive schema changes only.
- Add a dedicated blocked-face table rather than altering core consent tables.
- Prefer a shape parallel to `asset_face_hidden_states` because the current code already uses additive state tables for face-level operator actions.

Why additive is the smallest compatible approach:

- no existing table can safely represent blocked state without semantic corruption
- a fake consent row would be a larger semantic break than a small new table
- a dedicated blocked table keeps current reads and exports evolvable without redesigning the exact-face model

## 11. Security and authorization

Current face mutation routes follow the same protection pattern:

- authenticate the user server-side
- derive tenant id from the authenticated session
- validate project and asset membership server-side
- use server/admin Supabase access for tenant-scoped writes

Verified current protected operations:

- assigning a real consent to a face
- hiding a face
- restoring a face
- manually creating a face

Recommendation:

- Block assignment should fit the same protection model.
- Never accept tenant id from the client.
- Require asset/project membership checks and current-materialization face ownership checks server-side.
- Keep any block write route or server action scoped to one project asset face inside the tenant.

## 12. Edge cases the later plan must handle

- Blocking an auto-linked face should displace the current auto link and prevent immediate auto reattachment to that face.
- Blocking a manually linked face should displace the current manual link through an explicit operator-owned replacement path.
- Blocking an unlinked detected face should create active blocked state with no consent mutation.
- Blocking a manually drawn face should work exactly like blocking any other current face.
- Changing Block back to a real consent should clear the blocked state and then reuse the current manual link flow.
- Hidden face versus blocked face on the same asset should remain distinct. One face should not be both at once, but the asset can contain some hidden faces and some blocked faces.
- Multiple blocked faces on one image should be allowed.
- An asset can contain both consented people and blocked people at the same time.
- Future downstream interpretation should treat any active blocked face as enough to mark the asset blocked for publishing, unless later product requirements introduce more nuance.

## Risks and tradeoffs

- Adding blocked-face state means preview, reconciliation, and export reads will need one more exact-face branch.
- If replacement semantics are not reused carefully, blocking a linked face could accidentally allow auto linking to reoccupy the same face.
- If Block is modeled as consent-like, it will corrupt project, export, and structured-scope semantics.
- If hidden and blocked are conflated, operators will lose the distinction between "ignore this face" and "this face matters and blocks publishing."

## Open decisions for the plan phase

- Exact data model: dedicated `asset_face_block_states` table or another narrowly scoped equivalent name and shape.
- Whether blocking a linked face should write the existing `manual_replace` suppression for the displaced consent/face pair, or whether a block-specific suppression treatment is needed.
- Exact preview UI entry point wording and placement for `Block person`.
- Exact blocked-face preview representation:
  - new `faceState = 'blocked'`
  - supporting metadata returned in `preview-faces`
- Whether v1 stores only an enum reason like `no_consent`, or also allows an optional operator note.
- Exact route surface:
  - dedicated block route per face
  - or another server-side action shape that still preserves the current protected model
- How `reconcilePhotoFaceCanonicalStateForAsset(...)` should exclude or short-circuit blocked faces.
- How future export or DAM propagation should read blocked-face state without redesigning current export output in this feature.

## Recommended plan baseline

The bounded recommendation for planning is:

- add a dedicated face-level blocked assignment state independent from real consents
- keep blocked and hidden as separate concepts
- treat Block as manual operator-owned state only
- expose Block as an explicit selected-face action in the asset preview, not as a fake consent candidate
- reuse current replacement and manual-link flows where practical
- leave future export and DAM propagation enabled by the explicit face-level blocked state, but do not redesign downstream output in this feature
