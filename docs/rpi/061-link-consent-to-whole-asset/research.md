# Feature 061 Research: Link Consent to Whole Asset

## Scope

Research the smallest coherent feature that makes the current preview/lightbox `Link to entire asset` action real without redesigning exact-face linking.

The live repository is the source of truth. Prior RPI docs were used as boundary context only.

## Inputs reviewed

### Core repo docs

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`

### Prior RPI docs

- `docs/rpi/031-one-consent-per-face-precedence-rules/research.md`
- `docs/rpi/031-one-consent-per-face-precedence-rules/plan.md`
- `docs/rpi/044-asset-preview-linking-ux-improvements/research.md`
- `docs/rpi/044-asset-preview-linking-ux-improvements/plan.md`
- `docs/rpi/045-asset-preview-unlinked-faces-and-hidden-face-suppression/research.md`
- `docs/rpi/045-asset-preview-unlinked-faces-and-hidden-face-suppression/plan.md`
- `docs/rpi/047-manual-face-box-creation-in-asset-preview/research.md`
- `docs/rpi/047-manual-face-box-creation-in-asset-preview/plan.md`
- `docs/rpi/048-block-person-assignment-for-faces-without-consent/research.md`
- `docs/rpi/048-block-person-assignment-for-faces-without-consent/plan.md`
- `docs/rpi/055-project-participants-and-mixed-consent-intake/research.md`
- `docs/rpi/055-project-participants-and-mixed-consent-intake/plan.md`
- `docs/rpi/058-project-local-assignee-bridge-for-profile-backed-matches/research.md`
- `docs/rpi/058-project-local-assignee-bridge-for-profile-backed-matches/plan.md`
- `docs/rpi/059-auto-assignment-for-project-scoped-recurring-assignees/research.md`
- `docs/rpi/059-auto-assignment-for-project-scoped-recurring-assignees/plan.md`
- `docs/rpi/006-headshot-consent/research.md`
- `docs/rpi/006-headshot-consent/plan.md`
- `docs/rpi/019-face-materialization-deduped-embedding-pipeline/research.md`
- `docs/rpi/019-face-materialization-deduped-embedding-pipeline/plan.md`

### Live schema, helpers, routes, UI, and tests verified

- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/project-face-assignees.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/manual-asset-faces.ts`
- `src/lib/project-export/project-export.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/manual-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]/route.ts`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/components/projects/photo-link-review-dialog.tsx`
- `src/components/projects/consent-asset-matching-panel.tsx`
- `messages/en.json`
- `messages/nl.json`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260415210000_058_project_face_assignee_bridge.sql`
- `supabase/migrations/20260416090000_059_generic_face_assignee_suppressions.sql`
- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
- `tests/feature-044-asset-preview-linking-ux-improvements.test.ts`
- `tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`
- `tests/feature-047-manual-face-box-creation-in-asset-preview.test.ts`
- `tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`
- `tests/feature-058-project-local-assignee-bridge.test.ts`

### Code/docs mismatches found while verifying inputs

- The requested path `tests/feature-059-auto-assignment-for-project-scoped-recurring-assignees.test.ts` does not exist in the live repo.
- Feature 059 is still verifiable from live code and `supabase/migrations/20260416090000_059_generic_face_assignee_suppressions.sql`.

## Verified current asset-level fallback and preview boundary

### 1. `asset_consent_manual_photo_fallbacks` is still live and still current

Live schema and code confirm that `asset_consent_manual_photo_fallbacks` and `asset_consent_manual_photo_fallback_suppressions` are still active tables, created in migration 031 and still read and written by `src/lib/matching/photo-face-linking.ts`.

Current meaning in live code:

- manual only
- photo only
- zero-face only
- consent only
- keyed by `(asset_id, consent_id)`

This is not a generic asset-level assignee model.

### 2. Exact-face ownership is already generic-assignee-based, but fallback is not

Live code after 058 and 059 shows a split model:

- exact-face current ownership uses `asset_face_consent_links` plus `project_face_assignee_id`
- exact-face suppressions use `asset_face_assignee_link_suppressions`
- asset-level fallback still uses `asset_consent_manual_photo_fallbacks` plus `consent_id`

So the repo is already mixed:

- exact-face = assignee-based
- asset-level fallback = consent-based

Feature 059 explicitly widened exact-face suppressions and explicitly did not widen zero-face fallback.

### 3. Current exact-face system interacts with fallback only as a separate zero-face path

Live `manualLinkPhotoToConsent(...)` and `manualUnlinkPhotoFromConsent(...)` still treat `mode: "asset_fallback"` as a separate branch.

Current enforced rule:

- if detected face count is greater than `0`, `mode: "asset_fallback"` is rejected
- if detected face count is `0`, fallback can be created or removed

This is reinforced by live tests in `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`.

### 4. The current preview placeholder has no real whole-asset preview behavior

`src/components/projects/project-asset-preview-lightbox.tsx` still renders the `Link to entire asset` menu item as a disabled button.

The preview read model is exact-face-only:

- `getAssetPreviewFaces(...)` reads `listLinkedFaceOverlaysForAssetIds(...)`
- `listLinkedFaceOverlaysForAssetIds(...)` only returns exact current face links
- `getAssetPreviewFaceCandidates(...)` is keyed by `assetFaceId`
- the linked-people strip is built from `previewData.faces -> currentLink`

So the preview/lightbox has no whole-asset read model, no asset-level picker, and no asset-level write route.

### 5. There is backend behavior for zero-face fallback, but it is not the preview placeholder feature

The consent-centric route `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts` still supports `mode: "asset_fallback"`.

That capability is used by the older consent-centric `photo-link-review-dialog.tsx`, where:

- `detectedFaceCount === 0` maps to `mode: "asset_fallback"`
- the UI labels it as a zero-face whole-photo action

This means the repo already supports a limited asset-level fallback flow, but it is:

- consent-centric, not asset-centric
- zero-face-only
- not recurring-capable
- not wired into the current preview placeholder

## Current schema, routes, components, and helpers involved

### Exact-face foundations to preserve

- `asset_face_consent_links`
- `asset_face_assignee_link_suppressions`
- `project_face_assignees`
- `manualLinkPhotoToProjectFaceAssignee(...)`
- `manualLinkPhotoToRecurringProjectParticipant(...)`
- `manualUnlinkPhotoFaceAssignment(...)`
- `reconcilePhotoFaceCanonicalStateForAsset(...)`

### Current zero-face fallback seam

- `asset_consent_manual_photo_fallbacks`
- `asset_consent_manual_photo_fallback_suppressions`
- `manualLinkPhotoToConsent(...)` with `mode: "asset_fallback"`
- `manualUnlinkPhotoFromConsent(...)` with `mode: "asset_fallback"`
- `getManualPhotoLinkState(...)`
- `listLinkedPhotosForConsent(...)`

### Preview/lightbox seam

- `getAssetPreviewFaces(...)`
- `getAssetPreviewFaceCandidates(...)`
- `ProjectAssetPreviewLightbox`
- `preview-faces` route
- `preview-candidates` route
- current add-person menu and linked-people strip

### Hidden, blocked, and manual-face seams to preserve

- `hideAssetFace(...)`
- `restoreHiddenAssetFace(...)`
- `blockAssetFace(...)`
- `clearBlockedAssetFace(...)`
- `createManualAssetFace(...)`

### Export/downstream seam

- `loadProjectExportRecords(...)`
- `buildPreparedProjectExport(...)`

Current export already carries:

- exact-face `linkedAssignees`
- exact-face `linkedConsents`
- consent-only fallback rows, currently emitted as `linkMode: "asset_fallback"`

Recurring exact-face ownership already exports through `linkedAssignees`. Recurring asset-level fallback does not exist.

## Options considered

### Option A: Reuse and widen `asset_consent_manual_photo_fallbacks`

Pros:

- smaller migration from today's zero-face fallback code
- reuses current consent-side list and export seams

Cons:

- keeps asset-level linking consent-only at the storage root
- fights 058/059, where exact ownership is already assignee-based
- makes recurring whole-asset ownership awkward or duplicative
- keeps the misleading `fallback` framing even when faces exist

Verdict:

- not recommended as the primary 061 model

### Option B: Add a generic assignee-based asset-level link model

Pros:

- matches live exact-face ownership architecture
- supports both one-off and recurring assignees with one model
- is asset-scoped rather than photo-zero-face-scoped
- is the best future base for video assets

Cons:

- requires new preview read/write routes
- requires export widening
- requires a compatibility decision for existing zero-face fallback rows

Verdict:

- recommended

### Option C: Keep consent-only fallback and add a recurring-only parallel asset fallback

Pros:

- avoids touching old consent-only fallback tables immediately

Cons:

- creates two asset-level ownership systems
- duplicates preview, export, and unlink rules
- increases future migration cost immediately

Verdict:

- not recommended

## Recommended semantic model for whole-asset linking

Whole-asset linking should mean:

- this assignee is intentionally linked to the asset as a whole
- the link is manual operator-owned state
- the link is not tied to a specific detected face
- the link is weaker and less specific than exact-face ownership
- the link can be used when exact-face linking is impossible, incomplete, or intentionally not the right representation

It should not mean:

- replace exact-face ownership
- auto-resolve all unresolved faces
- bypass blocked/no-consent exact-face states

Recommended naming direction:

- stop treating the new feature as `fallback`
- use a whole-asset or asset-level name in product copy and storage semantics

## Recommended interaction with exact-face ownership

- Exact-face ownership remains the primary model for face-specific review and matching.
- Whole-asset links are separate asset-level ownership metadata.
- Multiple assignees may be linked to the same whole asset.
- Whole-asset links may coexist with exact-face links on the same asset for different assignees.
- In 061, the same assignee should not be shown as both an exact-face owner and a whole-asset owner on the same asset.
- If the same assignee already has an exact-face link on the asset, creating a whole-asset link should be rejected or the exact-face link should shadow the asset-level row.
- If a same-assignee exact-face link is created later, it should supersede the whole-asset row. The plan phase can choose eager delete vs read-time shadowing, but exact-face must win.
- Whole-asset links must not participate in exact-face conflict resolution or one-owner-per-face rules.

## Recommended interaction with hidden, blocked, and manual states

- Hidden faces stay hidden and remain exact-face state only.
- Blocked faces stay blocked and remain exact-face state only.
- Whole-asset links must not populate `currentLink` on blocked or hidden faces.
- Whole-asset linking must not clear blocked or hidden state.
- Assets may contain both whole-asset links and blocked faces at the same time.
- If blocked faces exist, whole-asset linking for another assignee may still be allowed, but the asset remains blocked for review/publishing purposes.
- Whole-asset links do not make an unresolved exact-face asset count as resolved.
- Manual face box creation stays the preferred path when the operator wants face-specific ownership.

## Recommended fit with the current preview/lightbox UI

Keep the current preview/lightbox as the main review surface and widen it minimally.

Recommended 061 preview behavior:

- enable the existing `Link to entire asset` menu item
- opening it should show an asset-level picker, not a face-scored picker keyed to `assetFaceId`
- reuse the current candidate card visual language where possible
- show whole-asset linked owners separately from exact-face linked owners because there is no face overlay to select
- keep the current linked-people strip for exact-face owners unchanged
- add a small second strip or tray for whole-asset owners
- selecting a whole-asset owner should open a bounded detail panel or tray with unlink action

The current face candidate tray should not be reused directly as-is because it is face-scored and face-addressed.

Recommended asset-level picker source:

- one-off project consent assignees
- recurring project-consent-backed assignees
- same blocked-reason read model already used for recurring preview candidates

Open question for plan:

- whether 061 also needs search/filter in that picker, or whether a bounded project-local list is acceptable for the first slice

## Required write, suppression, and model changes

### Recommended storage direction

Prefer one generic current-state table, for example:

- `asset_assignee_links`

Recommended shape:

- `asset_id`
- `project_face_assignee_id`
- `tenant_id`
- `project_id`
- `link_source` with manual-only in 061
- `created_at`
- `created_by`
- `updated_at`

Recommended key:

- unique `(asset_id, project_face_assignee_id)`

Recommended scope rules:

- FK to `(asset_id, tenant_id, project_id)`
- FK to `(project_face_assignee_id, tenant_id)`

### Suppression recommendation

For 061, prefer manual-only whole-asset linking with no new generic asset-level auto behavior.

Because of that, a new generic asset-level suppression table is not required in the first slice.

Recommended first-slice unlink semantics:

- unlink deletes the current whole-asset row
- duplicate unlink is idempotent
- manual re-link is immediately allowed

Current consent-only zero-face fallback suppressions can remain only as compatibility baggage if the old consent-centric path is not fully migrated in 061.

### Compatibility recommendation for current zero-face fallback

The live repo already has zero-face fallback data and export behavior.

Recommended direction:

- move the product model for asset-level ownership to the generic assignee-based table
- treat old zero-face fallback rows as migration/backfill input, not as the long-term 061 model
- keep backward compatibility only where needed for one-off consent-centric surfaces during the transition

## Recommended fit with export and downstream seams

Minimal widening is required and reasonable in 061.

Recommended export behavior:

- exact-face export stays unchanged
- whole-asset links appear in `linkedAssignees`
- consent-backed whole-asset links also appear in `linkedConsents`
- use a distinct `linkMode`, preferably `whole_asset`, not `asset_fallback`
- recurring whole-asset links stay assignee-only, consistent with current recurring exact-face export behavior
- `detectedFaces` metadata remains exact-face-only

Whole-asset links should not alter face-level detection metadata.

## Future-compatibility note for video support

The recommended generic assignee-based asset-level model is a good future base for video because it:

- is anchored to `asset_id`, not `assetFaceId`
- does not depend on current materialization face ids
- can express person coverage for an entire asset without a frame/face tracking model

This is a bounded compatibility win without designing video support now.

## Security and reliability considerations

- Keep all writes asset-centric and server-authoritative.
- Resolve tenant and project scope server-side from auth and route context.
- Do not accept `tenant_id` from the client.
- Prefer the current client contract style: accept `identityKind + consentId` or `identityKind + projectProfileParticipantId`, then resolve/ensure the assignee server-side.
- Reject new one-off whole-asset links for revoked consents.
- Reject new recurring whole-asset links unless there is an active signed project recurring consent.
- Preserve current rows if the underlying consent later becomes revoked, and surface that revoked state in reads and export rather than silently deleting data.
- Use upsert on `(asset_id, project_face_assignee_id)` for idempotent manual create.
- Keep delete idempotent for retries and double clicks.
- If same-assignee exact-face save also cleans a whole-asset row, keep that write sequence compact and retry-safe.

## Edge cases

- Photo has zero usable faces: whole-asset linking should work and should cover the current zero-face fallback use case.
- Photo has detected faces but the operator still wants whole-asset coverage: whole-asset linking should work without forcing face selection.
- Photo has exact-linked faces plus one whole-asset linked assignee: exact faces remain exact; whole-asset row is additional asset metadata.
- Same assignee already exact-linked: whole-asset create should not become a backdoor for repeated-face support.
- Asset has blocked faces plus a whole-asset link for another assignee: the asset remains blocked.
- Hidden faces stay hidden even when whole-asset links are added or removed.
- Manual face boxes remain available for later exact-link refinement.
- Materialization changes should not invalidate whole-asset links because they are asset-scoped, not face-scoped.
- Consent-side linked-photo views need a compatibility decision if the old zero-face tables are retired in 061.

## Explicitly deferred work

- automatic whole-asset linking
- matcher redesign
- frame-level or video-face tracking
- broad review queue redesign
- generic publishing-policy redesign
- tenant-directory-wide add-person search beyond project-local scope
- replacing exact-face ownership with whole-asset ownership
- recurring zero-face fallback as a separate parallel system

## Open decisions for the plan phase

- Exact table and route names for the new generic asset-level link model.
- Whether 061 fully migrates old zero-face fallback reads/writes in the same cycle, or keeps a temporary compatibility layer.
- Whether same-assignee exact-face supersession uses eager delete or read-time shadowing for stale whole-asset rows.
- Whether the asset-level picker needs search in the first slice.
- Whether the preview read route should return whole-asset links from `preview-faces` or from a second asset-level read route.
- Whether consent-side linked-photo pages should immediately display generic whole-asset rows in 061 or follow in a small subsequent cycle.

## Recommended smallest usable 061 slice

The best bounded slice is closest to Candidate 2, but kept manual-only:

- photos only
- manual-only whole-asset linking
- one generic assignee-based asset-level model
- supports both one-off and recurring assignees from day one
- minimal preview/lightbox UI widening
- minimal export widening
- no auto whole-asset linking
- no broader review workflow redesign

This is small enough for one normal RPI cycle, but avoids shipping a second consent-only asset-level model that would need immediate cleanup after 058 and 059.
