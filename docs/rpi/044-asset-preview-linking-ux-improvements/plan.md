# Feature 044 Plan: Asset Preview Linking UX Improvements

## Inputs and ground truth

This plan is based on the current repository state, not prior assumptions.

Docs re-read for this phase:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/044-asset-preview-linking-ux-improvements/research.md`

Current implementation re-verified before planning:

- `src/components/projects/assets-list.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/lib/client/face-overlay.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state/route.ts`
- `src/components/projects/photo-link-review-dialog.tsx`
- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/lib/client/face-review-selection.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/photo-face-linking.ts`

Ground-truth constraints from current code:

- The project assets page already uses a shared modal lightbox for asset preview.
- Overlay geometry, zoom, hover, and foreground behavior are already implemented and should be reused.
- Current asset preview overlays only represent currently linked exact faces.
- Current canonical writes already support:
  - unlinking a face link
  - replacing an auto assignee with a manual link
  - replacing a manual assignee via `forceReplace`
  - moving a consent from one face to another within the same asset
- Current write semantics already preserve:
  - one-consent-per-face
  - one-face-per-consent-per-asset
  - manual over auto precedence
  - suppression rules for unlink and replace

No schema or migration work is required for this feature as planned.

## Verified current boundary

The current live asset preview boundary is:

- `AssetsList` owns selected asset index, page cache, and previous/next navigation across paginated assets.
- `ImagePreviewLightbox` owns preview-local zoom, pan, and hovered overlay state.
- Overlay clicks currently navigate directly to the consent form on the project page.
- The paginated assets API returns enough data for the grid and overlay summaries, but not enough for:
  - linked face crop thumbnails
  - richer consent preview details
  - change-person picker rows
- Existing write APIs are already correct for remove and change flows and should not be replaced.

## Options considered

### Option A: Expand the existing paginated assets API

Pros:

- no new route surface
- simpler first render data flow

Cons:

- bloats the grid payload for assets the user never opens
- mixes grid concerns with preview-specific detail
- makes candidate picker data too easy to over-fetch

### Option B: Add bounded asset-preview read routes and reuse existing writes

Pros:

- keeps the paginated assets list focused on grid and overlay-summary data
- matches the actual interaction model of the feature
- keeps the change-person picker lazy
- preserves current canonical write semantics unchanged

Cons:

- adds one or two read routes
- requires preview-local fetch and refresh handling

### Option C: Reuse consent-centric review-session or manual-link-state routes

Pros:

- avoids adding preview-specific read routes

Cons:

- wrong shape for an asset-centric preview
- pulls in queue and consent-review assumptions
- broadens scope into the manual review workflow

## Recommendation

Choose Option B.

Implementation direction:

- keep the current modal asset-preview architecture
- keep current overlay rendering and geometry logic intact
- keep current write APIs and canonical helpers unchanged
- add bounded asset-centric read routes for preview details and picker rows
- keep all new interaction state local to the asset preview

## Chosen architecture

### Architecture summary

The chosen implementation is:

- retain the current asset-preview modal/lightbox architecture
- retain current zoom, pan, overlay positioning, hover highlighting, and previous/next behavior
- add a preview-local selected linked-face model on top of the current hover model
- add a linked-people strip below the image scene
- add a right-side consent preview panel
- lazy-load preview detail data with a new single-asset preview read API
- lazy-load change-person candidates with a second bounded asset-centric read API
- continue using the existing consent asset link write route for both remove and change actions

### Component structure

Chosen component shape:

- `AssetsList` remains the owner of:
  - selected asset index
  - asset page cache
  - previous/next asset navigation
  - forced refresh of the current asset page after writes
- asset preview interaction state remains local to the preview layer
- the preview layer gains one asset-preview-specific wrapper around the existing lightbox scene

Recommended implementation detail:

- extract or reuse the existing lightbox scene logic from `previewable-image.tsx` so the image scene, zoom logic, overlay transform math, and navigation controls stay shared
- add a project-asset-specific preview wrapper that composes:
  - the existing image scene
  - the linked-people strip
  - the right-side detail panel

This avoids overloading the generic standalone `PreviewableImage` lightbox behavior with consent-management-specific state.

### Exact v1 scope boundary

V1 includes only:

- currently linked exact faces for the selected asset
- linked-people strip below the preview image
- right-side consent preview panel for a selected linked face
- remove link from that panel
- change person from that panel
- a lightweight picker for choosing another consent/person

V1 explicitly excludes:

- unlinked-face inspection or manual linking from this preview
- zero-face fallback/manual-photo links in this preview surface
- reuse of review-session UI inside this preview
- candidate scoring or queue workflow redesign
- overlay geometry or zoom redesign

### Exact scope decisions

- The linked-people strip shows only currently linked exact faces.
- Zero-face fallback/manual-photo links are excluded from this surface.
- The right-side panel opens only for linked exact faces.
- Clicking an unlinked face remains unchanged because unlinked faces are not introduced into this preview.
- Current overlay hover/highlight behavior is preserved and extended, not replaced.

## State model

### Preview-local state

The asset preview wrapper should own:

- `hoveredLinkedFaceId: string | null`
- `selectedLinkedFaceId: string | null`
- `isChangePersonOpen: boolean`
- `isLoadingPreviewData: boolean`
- `isLoadingCandidates: boolean`
- `isSaving: boolean`
- `previewError: string | null`
- `actionError: string | null`
- `changeConflict: { currentAssigneeName: string | null; canForceReplace: boolean } | null`
- `moveExistingLinkWarning: { consentId: string; fromFaceLabel: string } | null`
- `previewData: AssetPreviewLinkedFacesResponse | null`
- `candidateData: AssetPreviewCandidateResponse | null`

Derived state:

- `linkedFaces = previewData?.linkedFaces ?? initialLinkedFacesFromAssetRow`
- `selectedLinkedFace = linkedFaces.find((face) => face.assetFaceId === selectedLinkedFaceId) ?? null`
- `isDetailsPanelOpen = selectedLinkedFace !== null`

### Hover and selected interaction rules

- Hover does not change selection.
- Hover controls foreground treatment and dimming exactly as the current overlay system does today.
- Selected state adds a persistent selected treatment to the chosen overlay and card.
- If a different overlay is hovered while one is selected:
  - the hovered overlay gets current foreground treatment
  - the selected overlay remains selected but not foregrounded
  - when hover ends, the selected overlay resumes the active state

### State reset rules

- On preview close:
  - clear `selectedLinkedFaceId`
  - clear `hoveredLinkedFaceId`
  - close the change-person picker
  - clear preview-local errors and conflict state
- On previous/next asset navigation:
  - clear `selectedLinkedFaceId`
  - clear `hoveredLinkedFaceId`
  - close the change-person picker
  - discard prior asset preview data and candidate cache
- On zoom changes:
  - keep `selectedLinkedFaceId`
  - keep `hoveredLinkedFaceId` if pointer is still valid
  - recompute overlay positions only

### Initial selection behavior

- Opening the preview does not auto-open the right-side panel.
- `selectedLinkedFaceId` starts as `null`.
- A user selects a linked face by:
  - clicking a linked overlay
  - clicking a linked-people strip card

## Exact read and write API plan

### Keep existing paginated assets API focused

`GET /api/projects/[projectId]/assets` remains the grid API.

It should continue to provide:

- asset image URLs and basic metadata
- linked consent count
- lightweight linked overlay summary data used for initial overlay rendering

It should not be expanded to include:

- preview panel consent detail
- linked face crop thumbnails
- picker candidates

### New preview read API

Add a new asset-centric route:

- `GET /api/projects/[projectId]/assets/[assetId]/preview-links`

Purpose:

- return the exact linked-face data needed by the linked-people strip and right-side panel for one selected asset
- keep payload limited to current exact linked faces only
- derive tenant and project scope server-side

Recommended response shape:

```ts
type AssetPreviewLinkedFacesResponse = {
  assetId: string;
  linkedFaces: Array<{
    assetFaceId: string;
    faceRank: number;
    faceBoxNormalized: Record<string, number | null> | null;
    faceThumbnailUrl: string | null;
    linkSource: "manual" | "auto";
    matchConfidence: number | null;
    consent: {
      consentId: string;
      fullName: string | null;
      email: string | null;
      status: "active" | "revoked";
      signedAt: string | null;
      consentVersion: string | null;
      faceMatchOptIn: boolean | null;
      structuredSnapshotSummary: string[] | null;
      headshotThumbnailUrl: string | null;
      goToConsentHref: string;
    };
  }>;
};
```

Field rationale:

- `assetFaceId`, `faceRank`, and `faceBoxNormalized` keep overlay-card-strip mapping exact.
- `faceThumbnailUrl` powers the linked-people strip and panel context image.
- `linkSource` and `matchConfidence` preserve current manual/auto visibility.
- `consent` contains a bounded preview, not the full consent detail payload.

### New change-person candidate API

Add a second lazy asset-centric route:

- `GET /api/projects/[projectId]/assets/[assetId]/preview-link-candidates`

Purpose:

- return lightweight person rows for the change-person picker
- restrict to active, signed consents in the same project and tenant
- include enough context to warn if a candidate is already linked elsewhere on the same asset

Recommended response shape:

```ts
type AssetPreviewCandidateResponse = {
  assetId: string;
  candidates: Array<{
    consentId: string;
    fullName: string | null;
    email: string | null;
    headshotThumbnailUrl: string | null;
    isCurrentSelection: boolean;
    currentAssetLink: {
      assetFaceId: string;
      faceRank: number | null;
    } | null;
  }>;
};
```

Field rationale:

- `headshotThumbnailUrl`, `fullName`, and `email` are the minimum useful picker row fields.
- `isCurrentSelection` prevents redundant save clicks.
- `currentAssetLink` supports an explicit warning when the chosen person is already linked to another face on the same asset.

### Existing write APIs reused unchanged

Keep using:

- `POST /api/projects/[projectId]/consents/[consentId]/assets/links`
- `DELETE /api/projects/[projectId]/consents/[consentId]/assets/links`

No new write route is added.

### Write semantics retained exactly

Remove link:

- call the existing `DELETE` route with:
  - `assetId`
  - `mode: "face"`
  - `assetFaceId`

Change person:

- call the existing `POST` route for the newly selected consent with:
  - `assetId`
  - `mode: "face"`
  - `assetFaceId`
  - `forceReplace: false`
- if the API returns `409 manual_conflict` with `canForceReplace`, show explicit confirmation and retry the same request with `forceReplace: true`

No new replace-link backend concept is introduced.

### New helper organization

Recommended server-side additions:

- add a small asset-preview read helper module, for example:
  - `src/lib/matching/asset-preview-linking.ts`
- keep existing canonical write helpers in:
  - `src/lib/matching/photo-face-linking.ts`

The new read helper should compose existing lower-level functions instead of reimplementing link logic:

- `listLinkedFaceOverlaysForAssetIds(...)`
- `listPhotoConsentAssignmentsForAssetIds(...)` where useful
- `loadFaceImageDerivativesForFaceIds(...)`
- `signFaceDerivativeUrls(...)`
- `loadCurrentProjectConsentHeadshots(...)`
- `signThumbnailUrlsForAssets(...)`

### No migration plan

- no new tables
- no new constraints
- no changes to suppression or precedence semantics

## Exact UI changes

### Main preview layout

The preview keeps the current header and image scene feel, but the body becomes a two-part layout:

- left content column:
  - image scene with overlays, navigation, and zoom controls
  - linked-people strip directly below the scene
- right content column:
  - consent preview panel for the selected linked face

Recommended layout structure:

- desktop `xl` and above:
  - two-column layout
  - left scene column flexes
  - right panel width fixed around `340px` to `380px`
- below `xl`:
  - single-column stack
  - scene first
  - linked-people strip second
  - details panel third

### Overlay interaction change

Within the asset preview only:

- clicking a linked overlay selects the face instead of navigating away immediately
- the panel provides the canonical "Go to consent form" action

Outside this feature:

- existing overlay navigation behavior in other preview contexts remains unchanged

### Linked-people strip design

Exact v1 strip design:

- one card per linked exact face
- ordered by `faceRank` ascending
- each card shows:
  - linked asset face crop thumbnail
  - person name
  - small secondary line:
    - email when available
    - otherwise a small status line such as `Manual` or `Auto · 87%`

Recommended interaction behavior:

- hover card:
  - set `hoveredLinkedFaceId`
  - highlight and foreground the matching overlay
- hover overlay:
  - highlight matching strip card
- click card:
  - set `selectedLinkedFaceId`
  - open the right-side panel for that face

Selected card behavior:

- selected card gets a persistent selected border and background treatment
- it remains selected while another card or overlay is only hovered

Empty state:

- if no linked exact faces exist, show a short empty card row:
  - "No linked people on this image yet."

### Right-side consent preview panel

The panel stays intentionally smaller than the full consent form page.

Exact fields shown:

- linked face crop thumbnail
- consent headshot thumbnail when available
- person name
- email
- consent status:
  - active
  - revoked
- signed date
- consent version
- face match opt-in
- structured snapshot summary when present
- link source:
  - manual
  - auto
- match confidence when present

Exact actions shown:

- `Go to consent form`
- `Remove link`
- `Change person`

Panel behavior:

- no selection:
  - show a placeholder message
  - desktop keeps the panel shell visible to avoid layout shift
- linked face selected:
  - show consent preview and actions
- picker open:
  - expand the panel with the picker section below the preview summary

### Change-person picker UX

Chosen picker shape:

- expandable section inside the right-side panel

Why this is the chosen v1:

- avoids a nested modal inside the lightbox
- keeps the selected face context visible
- keeps image and consent preview context on screen
- is simpler than introducing another overlay layer

Exact v1 picker behavior:

- the picker loads lazily the first time the user opens `Change person`
- no search or filter in v1
- rows are scrollable within the panel section
- each row shows:
  - headshot thumbnail
  - name
  - email
- if the row is already the selected linked consent:
  - show `Current`
  - disable save/reselect
- if the row is already linked elsewhere on the same asset:
  - show `Linked to Face N`
  - allow selection, but require move confirmation before submit

### Thumbnail strategy

Linked-people strip:

- primary thumbnail: linked asset face crop derivative
- fallback: neutral face placeholder or initials chip

Right-side panel:

- show linked asset face crop as the primary contextual image
- show consent headshot thumbnail as the secondary person image when available
- fallback headshot: initials/avatar chip

Change-person picker:

- primary thumbnail: consent headshot thumbnail
- fallback: initials/avatar chip

## Remove-link behavior

### Chosen approach

- no new unlink backend route
- reuse current unlink API unchanged
- no local optimistic mutation of canonical link state

### UI sequence

1. User clicks `Remove link` in the right-side panel.
2. UI disables panel actions and sends the existing `DELETE` request.
3. On success:
   - refetch preview data for the selected asset
   - force-refresh the current asset page data in `AssetsList`
   - clear `selectedLinkedFaceId`
   - close the change-person picker if open
4. If the selected asset has no remaining linked faces:
   - strip shows empty state
   - panel returns to placeholder state

### Error handling

- keep the panel open
- preserve current selection if the delete failed
- show an inline panel error message
- re-enable actions without clearing current data

## Change-person behavior

### Chosen approach

- no new replace backend route
- no client-side unlink-then-relink sequence
- reuse the existing manual-link route for the chosen replacement consent and current `assetFaceId`

### Standard replacement flow

1. User opens `Change person`.
2. User selects a replacement person row.
3. UI checks picker metadata:
   - if the chosen person is currently linked to another face on the same asset, show a move confirmation first
4. UI sends the existing `POST` request to the chosen consent with:
   - `assetId`
   - `mode: "face"`
   - `assetFaceId`
   - `forceReplace: false`
5. On success:
   - refetch preview data for the selected asset
   - force-refresh the current asset page data in `AssetsList`
   - keep `selectedLinkedFaceId` on the same face
   - close the picker
   - update panel contents to the newly linked consent

### Manual conflict handling

Chosen conflict pattern:

- do not pre-emptively ask for `forceReplace`
- rely on the existing backend conflict response
- if `409 manual_conflict` is returned:
  - show inline conflict details in the panel
  - show a bounded confirm action:
    - `Replace current manual assignee`
  - retry the same `POST` request with `forceReplace: true` only after explicit user confirmation

This matches the current API contract and avoids inventing client-side conflict rules.

### Already-linked-elsewhere-on-asset behavior

Current backend behavior already supports moving a consent from one face to another within the same asset.

Chosen UI behavior:

- show a warning before submit when the picker row indicates the chosen person is already linked to another face on the same asset
- confirmation text should make the side effect explicit:
  - the old face link will be removed
  - the selected face will become that person's new exact face link
- after confirmation, use the normal existing `POST` flow

### Error handling

- keep the selected face and panel open
- keep the picker open when save fails
- show inline error or conflict details in the panel
- do not clear loaded preview data on failure

## Performance and refresh strategy

### Data-loading strategy

Keep the existing paginated assets list response as the fast initial render source.

Initial preview open:

- open immediately using asset data already loaded in `AssetsList`
- render overlays immediately from `selectedAsset.linkedFaceOverlays`
- then fetch `preview-links` in the background for richer linked-face data

Change-person picker:

- load candidates lazily only when the picker is first opened for the current asset
- cache candidate rows for the current asset for the lifetime of the preview

### Refresh strategy after writes

Prefer simple refetch over optimistic local cache surgery.

After remove or change actions:

- refetch the selected asset's `preview-links`
- force-refresh the current asset page entry in `AssetsList`
- if the refreshed current page changes counts or overlay summaries, let the preview rerender from updated page state

No optimistic rewrite of:

- asset page cache
- linked consent counts
- overlay arrays
- picker candidate rows

This keeps client state simpler and reduces inconsistency risk.

### Overlay rerender safety

Overlay geometry math remains unchanged.

The plan only adds:

- selected-face state
- strip and panel rendering
- preview-local fetch state

This should not alter the normalized-box-to-pixel transform path in `face-overlay.ts`.

## Security and reliability considerations

### View permissions

Users who can access the project assets page can view the preview-linked-face data for that project asset.

New read routes must:

- require authentication
- derive tenant scope server-side
- validate `projectId` and `assetId` within that tenant
- never accept `tenant_id` from the client

### Write permissions

Remove and change actions keep using the existing write routes, which already:

- derive tenant scope server-side
- validate the consent within tenant and project
- validate the asset and face within tenant and project
- enforce canonical writes in server-side helpers

### Tenant and project scoping

All new read helpers and routes must filter by:

- `tenant_id`
- `project_id`
- `asset_id`

Any consent summary or candidate lookup used by the preview must also remain scoped to the same tenant and project.

### Reliability and failure handling

- New read routes should return `Cache-Control: no-store, max-age=0` to avoid stale preview data after writes.
- Preview writes should disable duplicate submission while in flight.
- Expired sessions or auth failures should surface as standard route errors and leave current preview UI intact.
- Partial failure handling:
  - if the write succeeds but preview refetch fails, show a refresh error and keep the preview open rather than assuming stale data is correct
  - the user can retry the refresh or close and reopen the preview

## Edge cases

- Asset with no linked faces:
  - overlays render none
  - strip shows empty state
  - panel shows placeholder
- Linked face with missing thumbnails:
  - strip and panel use placeholder/initials fallbacks
  - overlay remains the primary locator
- Linked face whose consent is revoked:
  - panel still renders linked summary
  - status clearly shows revoked
  - remove link remains available
  - go-to-consent action remains available if the user can view the consent
- Change-person target already linked elsewhere on the same asset:
  - picker row indicates current linked face
  - user must confirm the move before submit
  - existing manual-link flow performs the move
- Remove link followed quickly by change person:
  - actions are serialized by disabling writes while a request is in flight
  - after unlink completes, preview refetch updates the available state before the next change action
- Previous or next navigation while panel is open:
  - selected face and picker state reset
  - the next asset opens with no selected face
- Selected overlay while zoom changes:
  - selection persists by `assetFaceId`
  - overlay positions recompute only visually
- Fallback/manual-photo links with no exact face box:
  - excluded from this feature
  - existing consent-centric review surfaces continue to handle them

## Test plan

### Component and interaction tests

Add focused UI tests for the asset preview wrapper and related components:

- preview opens with existing overlay behavior intact
- hovering a strip card highlights the matching overlay
- hovering an overlay highlights the matching strip card
- clicking a linked overlay selects the face and opens the panel
- clicking a linked card selects the same face and opens the panel
- selected state persists across hover changes
- selected state resets on previous/next navigation
- selected state resets on preview close
- selected state survives zoom changes

### Strip and panel rendering tests

- linked-people strip renders cards in `faceRank` order
- empty state renders when no linked exact faces exist
- panel placeholder renders when no face is selected
- panel shows revoked badge/status when linked consent is revoked
- thumbnail fallbacks render when face crop or headshot thumbnail is missing

### Write-flow tests

- `Remove link` calls the existing unlink API with `mode: "face"` and `assetFaceId`
- successful remove clears selected face and refreshes preview state
- failed remove keeps panel open and shows an error
- `Change person` calls the existing manual-link API for the selected consent and face
- successful change keeps the selected face and updates the panel to the new person
- `409 manual_conflict` shows force-replace confirmation UI
- confirming force replace retries with `forceReplace: true`

### Route and helper tests

Add route or helper tests for the new read APIs:

- preview read route returns only exact linked faces for the requested asset
- preview read route includes linked face crop and bounded consent summary data
- candidate route returns only tenant- and project-scoped candidate consents
- candidate route excludes revoked or otherwise non-linkable replacement choices
- candidate route includes current same-asset link metadata where present

### Regression coverage

- existing face overlay positioning math remains unchanged
- existing write semantics for manual over auto and suppressions remain unchanged
- no new route exposes cross-tenant or cross-project data

## Implementation phases

### Phase 1: Preview read data and types

- add new asset-preview read helper module
- add `GET /api/projects/[projectId]/assets/[assetId]/preview-links`
- add `GET /api/projects/[projectId]/assets/[assetId]/preview-link-candidates`
- define shared response types for preview data and picker rows
- add route tests for scope and payload shape

### Phase 2: Preview wrapper and selected-face state

- introduce the asset-preview-specific lightbox wrapper
- keep the current scene, zoom, and overlay transform logic intact
- add preview-local hovered and selected linked-face state
- add linked-people strip below the image
- wire overlay and strip hover/select synchronization

### Phase 3: Right-side consent preview panel

- add the preview panel shell and placeholder state
- render bounded consent summary fields
- render linked face and headshot thumbnails with fallbacks
- move the explicit consent navigation action into the panel

### Phase 4: Remove and change actions

- wire `Remove link` to the existing unlink route
- add expandable `Change person` picker section
- lazy-load picker candidates
- handle move-confirmation when the chosen person is already linked elsewhere on the asset
- handle `manual_conflict` and `forceReplace`
- add write-flow refresh logic to preview and current asset page cache

### Phase 5: Tests and polish

- interaction and regression tests
- responsive layout tuning
- loading, disabled, and error states
- ensure keyboard and pointer behavior still feels coherent inside the lightbox

## Scope boundaries

Explicitly out of scope for Feature 044:

- unlinked-face preview linking
- full review-session reuse inside the asset preview
- zero-face fallback/manual-photo management in this surface
- generic person-picker redesign
- overlay geometry redesign
- broader matching or consent-review workflow redesign
- project-wide permission redesign
- schema changes or canonical link-model changes

## Concise implementation prompt

Implement Feature 044 by adding an asset-preview-specific linked-face management layer around the existing project asset lightbox. Keep the current overlay geometry, zoom, hover highlighting, and previous/next navigation behavior intact. Add a linked-people strip for exact linked faces below the image, add a right-side consent preview panel for the selected linked face, and add an inline expandable change-person picker inside that panel. Do not add new write semantics: reuse the existing unlink route for remove, reuse the existing manual-link route for change, and use the current `forceReplace` conflict flow when required. Add bounded asset-centric read routes for preview details and picker candidates, keep zero-face fallbacks and unlinked-face linking out of scope, and prefer refetch-based refresh after writes over optimistic client-side cache rewrites.
