# Feature 045 Plan: Asset Preview Unlinked Faces, Candidate Linking, and Hidden Face Suppression

## Inputs and ground truth

This plan is based on:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- verified research in `docs/rpi/045-asset-preview-unlinked-faces-and-hidden-face-suppression/research.md`

Targeted live verification was done only for plan-critical conclusions in:

- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260404110000_032_face_review_sessions_and_derivatives.sql`

## Verified current boundary

The current live boundary is:

- Feature 044 already gives the asset preview:
  - exact linked-face overlays
  - linked-people strip
  - right-side linked-consent preview panel
  - remove-link
  - change-person
- `ImagePreviewLightbox` already supports:
  - controlled hovered overlay id
  - controlled selected overlay id
  - overlay activation callbacks
  - `belowScene`
  - `sidePanel`
  - zoom, pan, and overlay transform reuse
- Current asset-preview reads are linked-face-only:
  - `GET /api/projects/[projectId]/assets/[assetId]/preview-links`
  - `GET /api/projects/[projectId]/assets/[assetId]/preview-link-candidates`
- Current canonical manual face linking is already correct and reusable:
  - `POST /api/projects/[projectId]/consents/[consentId]/assets/links`
  - `manualLinkPhotoToConsent(...)`
- Current unlink semantics are face/consent-specific, not face-hidden-global:
  - `manualUnlinkPhotoFromConsent(...)`
  - `asset_face_consent_link_suppressions`
- There is still no hidden-face model in schema or helper code.

## Options considered

### Option A: Broaden the existing linked-only preview route

Pros:

- fewer routes
- lowest apparent surface-area increase

Cons:

- current `preview-links` naming and payload are linked-only
- mixing linked-face detail, unlinked-face state, and hidden-face state in the same legacy read model is harder to reason about

### Option B: Reuse consent-centric `manual-link-state` inside asset preview

Pros:

- already returns all detected faces
- already includes face crops, current assignee, and match confidence

Cons:

- wrong shape for asset-centric browsing
- requires a consent id before the user chooses a person
- can trigger direct materialization work
- does not model hidden faces

### Option C: Add bounded asset-centric face reads plus a separate hidden-face model

Pros:

- preserves the current 044 preview architecture
- reuses current overlay geometry and lightbox behavior
- reuses the existing manual-link write route unchanged
- keeps face hiding separate from face/consent suppressions
- keeps zero-face fallback out of this surface

Cons:

- adds one new preview read route, one new face-candidate route, and one new hide/restore write surface
- requires hidden-aware filtering in a few existing read/reconcile helpers

## Recommendation

Choose Option C.

This feature should:

- keep the current preview/lightbox architecture
- keep the current overlay math and scene behavior
- add an asset-centric all-current-faces preview read model
- add a materialization-scoped hidden-face state table
- reuse the existing manual-link write route for saving an unlinked face assignment
- add focused hide and restore routes
- make hidden-face filtering explicit in the active preview and active matching surfaces used by this feature

## Chosen architecture

### Architecture summary

Feature 045 will:

- retain `AssetsList -> ProjectAssetPreviewLightbox -> ImagePreviewLightbox`
- retain current zoom, pan, hover, selected overlay, and transform logic
- replace the current linked-only preview fetch in the lightbox with a new asset-centric `preview-faces` read route
- keep the current 044 right-side panel model for linked exact faces
- add an unlinked-face candidate tray in the below-image preview area
- add a hidden-face restore tray in the below-image preview area
- add a dedicated hidden-face table and hide/restore write helpers

### Exact v1 scope boundary

Included:

- current detected faces on the selected asset only
- distinct preview states for:
  - linked manual
  - linked auto
  - unlinked detected
  - hidden, only when explicitly shown
- selecting an unlinked detected face
- loading ranked candidates for that selected face
- saving a link through the existing manual-link route
- hiding a detected face
- restoring a hidden face
- excluding hidden faces from active preview summaries and active matching/read surfaces in scope for this feature

Excluded:

- zero-face fallback/manual-photo management in this preview
- durable cross-rematerialization face identity
- review-session reuse inside the preview
- generic review queue redesign
- automatic restoration of old links on unhide
- matching pipeline redesign
- overlay engine redesign

### Exact v1 decisions

- The feature is current-materialization-face-only.
- Zero-face fallback/manual-photo links remain excluded from this preview surface.
- Hidden faces are not rendered in the default active view.
- Hidden faces are included in the face-read payload with a hidden state flag and are filtered client-side unless `showHiddenFaces` is enabled.
- Restoring a face returns it as a normal unlinked detected face in v1.
- Restore does not automatically recreate the prior manual or auto link.

## Exact schema plan

### New table: `public.asset_face_hidden_states`

Chosen model:

- a separate, auditable, materialization-scoped table
- active hidden state is soft, not delete-only
- restore is an update, not row deletion

Recommended columns:

- `id uuid primary key default gen_random_uuid()`
- `asset_face_id uuid not null references public.asset_face_materialization_faces(id) on delete cascade`
- `asset_materialization_id uuid not null references public.asset_face_materializations(id) on delete cascade`
- `asset_id uuid not null`
- `tenant_id uuid not null references public.tenants(id) on delete restrict`
- `project_id uuid not null`
- `reason text not null default 'manual_hide'`
- `hidden_at timestamptz not null default now()`
- `hidden_by uuid null references auth.users(id) on delete set null`
- `restored_at timestamptz null`
- `restored_by uuid null references auth.users(id) on delete set null`

Recommended constraints and indexes:

- foreign key `(asset_id, tenant_id, project_id)` to `assets`
- check `reason in ('manual_hide')`
- partial unique index on `(asset_face_id)` where `restored_at is null`
- index on `(tenant_id, project_id, asset_id, restored_at, hidden_at desc)`
- index on `(tenant_id, project_id, asset_materialization_id, restored_at)`

### Why this shape is chosen

- keeps detection evidence separate from user moderation state
- preserves hide/restore history
- keeps v1 bounded to current materialization identity
- matches the repo's existing pattern of user decisions in separate tables

### Materialization scope decision

Feature 045 explicitly chooses current-materialization-scoped hidden state only.

That means:

- active hidden rows are only valid for the current `asset_materialization_id`
- stale active hidden rows must be ignored and cleaned when current materialization changes
- no cross-rematerialization remap is attempted in v1

## Exact hidden-face semantics

### Hiding an unlinked detected face

Behavior:

1. Validate tenant, project, asset, and current `assetFaceId`.
2. Validate the face belongs to the current materialization.
3. Upsert an active hidden-state row for that face.
4. Do not create any face/consent suppression because no assignee exists.
5. Do not run immediate auto reconcile.
6. Refresh preview face state.

Result:

- the face disappears from the default active overlay set
- it no longer contributes to active preview summaries
- it is recoverable later via `showHiddenFaces`

### Hiding an auto-linked face

Behavior:

1. Resolve the current exact assignee from `asset_face_consent_links`.
2. Remove the current exact link using the same unlink/suppression semantics as the existing face unlink flow.
3. Persist hidden-face state.
4. Run hidden-aware face reconciliation so the hidden face stays unassigned while hidden.
5. Refresh preview face state.

Result:

- the active exact link is removed
- the displaced consent receives the existing face/consent suppression
- the face becomes hidden and inactive

### Hiding a manually linked face

Behavior:

1. Resolve the current exact assignee from `asset_face_consent_links`.
2. Remove the current exact link using the same unlink/suppression semantics as the existing face unlink flow.
3. Persist hidden-face state.
4. Do not re-create the old manual link invisibly.
5. Refresh preview face state.

Result:

- the current manual face link is removed
- the consent receives the existing face/consent suppression
- the face becomes hidden and inactive

### Restore behavior

Behavior:

1. Validate tenant, project, asset, current materialization, and `assetFaceId`.
2. Mark the active hidden-state row restored.
3. Do not recreate the previous manual or auto link.
4. Do not run immediate auto reconcile.
5. Refresh preview face state.

Result:

- the face returns as a normal unlinked detected face
- the user may manually link it
- future matching work may score it again later, but v1 does not auto-restore old links

## Exact write and helper plan

### Existing write APIs that remain unchanged

Keep unchanged:

- `POST /api/projects/[projectId]/consents/[consentId]/assets/links`
- `DELETE /api/projects/[projectId]/consents/[consentId]/assets/links`

Their role in Feature 045:

- save/confirm on an unlinked face uses the existing `POST` route
- linked-face remove from the existing 044 panel continues to use the existing `DELETE` route

### Focused internal helper reuse

Feature 045 should not introduce a new generic replace-link backend concept.

It should add or extract focused internal helpers such as:

- `loadCurrentFaceAssignmentForAssetFace(...)`
- `unlinkCurrentExactFaceAssignmentWithSuppression(...)`
- `hideAssetFace(...)`
- `restoreHiddenAssetFace(...)`
- `loadCurrentHiddenFacesForAsset(...)`

The new hide helper should reuse the existing unlink/suppression semantics, but it must not require the client to provide a consent id.

### New hide and restore routes

Chosen route shape:

- `POST /api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]`
- `DELETE /api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]`

Rationale:

- asset and face identity are explicit in the path
- no client body is needed for the core action
- route stays asset-centric, matching the preview surface

### Reliability decision

Hide and restore writes must be idempotent.

Expected behavior:

- duplicate hide on the same face is safe
- duplicate restore on the same face is safe
- retry after partial failure converges correctly

Because hide is multi-step, the implementation should use a narrow server helper with retry-safe sequencing rather than scattering logic across the route handler.

## Exact preview read plan

### Chosen read route

Add:

- `GET /api/projects/[projectId]/assets/[assetId]/preview-faces`

The current preview UI should switch from `preview-links` to `preview-faces`.

`preview-links` can remain temporarily for compatibility, but Feature 045 should treat `preview-faces` as the new source of truth for the asset preview.

### Exact response shape

```ts
type AssetPreviewFacesResponse = {
  assetId: string;
  materializationId: string | null;
  detectedFaceCount: number;
  activeLinkedFaceCount: number;
  hiddenFaceCount: number;
  faces: Array<{
    assetFaceId: string;
    faceRank: number;
    faceBoxNormalized: Record<string, number | null> | null;
    faceThumbnailUrl: string | null;
    detectionProbability: number | null;
    faceState: "linked_manual" | "linked_auto" | "unlinked" | "hidden";
    hiddenAt: string | null;
    currentLink: null | {
      consentId: string;
      linkSource: "manual" | "auto";
      matchConfidence: number | null;
      consent: {
        fullName: string | null;
        email: string | null;
        status: "active" | "revoked";
        signedAt: string | null;
        consentVersion: string | null;
        faceMatchOptIn: boolean | null;
        structuredSnapshotSummary: string[] | null;
        headshotThumbnailUrl: string | null;
        headshotPreviewUrl: string | null;
        goToConsentHref: string;
      };
    };
  }>;
};
```

### Response behavior

- include all current detected faces for the current materialization
- include hidden faces in the payload with `faceState: "hidden"`
- do not omit hidden faces server-side, so the client can toggle them without refetching
- for hidden faces:
  - `currentLink` should be `null`
  - they are not part of `activeLinkedFaceCount`
- for linked faces:
  - return bounded consent preview data already similar to 044
- for unlinked faces:
  - return face geometry and thumbnail only

### Sorting

- sort `faces[]` by `faceRank asc`
- derive linked strip order from the same `faceRank` order, filtered to active linked states

## Exact candidate API and ranking plan

### Chosen candidate route

Add:

- `GET /api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates`

This route is:

- asset-centric
- face-scoped
- lazy-loaded only when an unlinked face is selected

### Exact candidate payload

```ts
type AssetPreviewFaceCandidatesResponse = {
  assetId: string;
  materializationId: string;
  assetFaceId: string;
  candidates: Array<{
    consentId: string;
    fullName: string | null;
    email: string | null;
    headshotThumbnailUrl: string | null;
    rank: number | null;
    similarityScore: number | null;
    scoreSource: "current_compare" | "likely_candidate" | "unscored";
    currentAssetLink: {
      assetFaceId: string;
      faceRank: number | null;
    } | null;
  }>;
};
```

### Ranking model

Primary ranking source:

- current compare rows from `asset_consent_face_compares`

Criteria:

- current compare version only
- current asset materialization only
- current headshot materialization only
- `compare_status = 'matched'`
- `winning_asset_face_id = selected assetFaceId`
- consent not revoked

Order:

- `winning_similarity desc`
- `consent_id asc` as deterministic tie-break

Secondary ranking source:

- current rows from `asset_consent_match_candidates`

Criteria:

- `winning_asset_face_id = selected assetFaceId`
- not already included from compare rows
- consent not revoked

Order:

- `confidence desc`
- `last_scored_at desc`
- `consent_id asc`

Final fallback set:

- remaining signed, non-revoked project consents not already included
- includes non-opted-in consents, because manual face linking already allows them

Fallback order:

- `signed_at desc`
- `consent_id asc`

### Candidate exclusions

Exclude from candidate rows:

- revoked consents
- consents already suppressed for this exact face
- the selected face if it is currently hidden

Keep in candidate rows, but mark with `currentAssetLink`:

- candidates already linked elsewhere on the same asset

This preserves current move-warning behavior.

## Exact hidden-aware filtering plan

This feature must explicitly exclude hidden faces from the following active surfaces in v1:

- default preview overlay rendering
- linked-face strip
- right-side linked-face panel inputs
- `listLinkedFaceOverlaysForAssetIds(...)`
- `listPhotoConsentAssignmentsForAssetIds(...)`
- asset-grid `linkedConsentCount`
- asset-grid `linkedPeople`
- hidden-aware `preview-faces` active-linked summary counts
- `resolveLikelyCandidateBatch(...)`
- `listMatchableProjectPhotosForConsent(...)` likely mode
- `reconcilePhotoFaceCanonicalStateForAsset(...)`

Rules:

- hidden faces are ignored as active overlay/linkable faces
- hidden faces are excluded from auto contender grouping during reconciliation
- hidden faces are excluded from likely-match asset surfacing
- hidden faces remain visible only when explicitly requested by the preview toggle

## Exact UI state plan

### Preview-local state

The preview wrapper should own:

- `hoveredFaceId: string | null`
- `selectedFaceId: string | null`
- `showHiddenFaces: boolean`
- `selectedFaceKind: "linked" | "unlinked" | "hidden" | null`
- `isLoadingFaces: boolean`
- `isLoadingCandidates: boolean`
- `isSavingLink: boolean`
- `isSavingHide: boolean`
- `isSavingRestore: boolean`
- `previewError: string | null`
- `actionError: string | null`
- `facesData: AssetPreviewFacesResponse | null`
- `candidateData: AssetPreviewFaceCandidatesResponse | null`
- `selectedCandidateConsentId: string | null`

### Derived state

- `allFaces = facesData?.faces ?? []`
- `visibleFaces = showHiddenFaces ? allFaces : allFaces.filter((face) => face.faceState !== "hidden")`
- `linkedFaces = allFaces.filter((face) => face.faceState === "linked_manual" || face.faceState === "linked_auto")`
- `selectedFace = allFaces.find((face) => face.assetFaceId === selectedFaceId) ?? null`

### Reset rules

On preview close:

- clear hovered face
- clear selected face
- clear candidate data
- clear selected candidate
- clear action errors
- reset `showHiddenFaces` to `false`

On previous/next asset navigation:

- same resets as close
- load the next asset's `preview-faces`

On zoom changes:

- keep `selectedFaceId`
- keep `hoveredFaceId` if still valid
- recompute visual overlay positions only

### Hover and selected interaction rules

- hover controls foreground treatment and dimming
- selected state is persistent until cleared or asset changes
- if a different face is hovered while one is selected:
  - hovered face gets foreground treatment
  - selected face remains selected
  - selected face resumes active treatment after hover ends

## Exact UI layout and interaction plan

### Main layout

Keep the current 044 layout shell:

- image scene with overlays
- below-scene section
- right-side panel

### Below-scene section

The below-scene section becomes a small stack:

1. linked-face strip header row
   - title
   - `Show hidden faces` toggle
2. linked-face strip
   - active linked faces only
3. contextual tray
   - shown only when selected face is unlinked or hidden

### Right-side panel

The right-side panel remains reserved for linked exact faces only.

Linked face selected:

- open right-side consent preview panel
- allow:
  - go to consent form
  - remove link
  - change person
  - hide face

Unlinked face selected:

- close linked-consent panel
- show compact candidate tray below the image

Hidden face selected:

- close linked-consent panel
- show restore tray below the image

### Overlay styling

Extend current overlay styling by face state:

- linked manual: current manual-linked tone
- linked auto: current auto-linked tone
- unlinked: neutral detectable-face tone
- hidden: muted low-contrast tone when `showHiddenFaces` is enabled

No overlay geometry redesign is needed.

## Exact face interaction plan

### Manual linked face click

- select that face
- keep hover behavior
- open right-side panel with linked consent preview

### Auto linked face click

- same as manual linked face click
- show link source as auto

### Unlinked detected face click

- select that face
- close right-side panel
- load face-scoped candidates lazily
- show candidate tray below the image

### Hidden face click when shown

- select that face
- close right-side panel
- show restore tray below the image

### Hide action

Available from:

- linked face panel
- unlinked face candidate tray

Behavior:

- save hide in flight
- refresh `preview-faces`
- clear candidate selection
- keep `showHiddenFaces` unchanged
- if hidden faces are not shown, clear `selectedFaceId`
- if hidden faces are shown, keep selection on the now-hidden face

### Restore action

Available only from the hidden-face tray.

Behavior:

- save restore in flight
- refresh `preview-faces`
- keep selection on the restored face as unlinked
- reopen candidate tray if helpful, but do not auto-load unless the tray is the current mode

### Save new link for unlinked face

Behavior:

- user selects a candidate
- user must click `Save`
- UI calls the existing manual-link route for that candidate consent and selected `assetFaceId`
- if the route returns `manual_conflict` with `canForceReplace`, reuse the current `forceReplace` retry flow
- on success:
  - refetch `preview-faces`
  - keep the same `selectedFaceId`
  - the selected face now becomes linked and opens the right-side panel

## Security and authorization

All new read and write paths must:

- authenticate the user with the server Supabase client
- derive tenant id server-side via `resolveTenantId(...)`
- use explicit tenant and project filters on all reads and writes
- validate that `assetId` belongs to the project
- validate that `assetFaceId` belongs to the asset's current materialization
- never accept `tenant_id` from the client

Specific route rules:

- `preview-faces`
  - tenant/project/asset scoped
- face candidate route
  - tenant/project/asset/current-face scoped
- hide route
  - tenant/project/asset/current-face scoped
- restore route
  - tenant/project/asset/current-face scoped

No permission broadening is required beyond the current project-assets page boundary.

## Reliability and failure handling

### Duplicate and retry safety

- duplicate save-link requests remain safe via current manual-link semantics
- duplicate hide is safe via active hidden-state upsert/update logic
- duplicate restore is safe via idempotent restore update logic

### Partial failure behavior

Hide flow:

- if unlink succeeds but hidden-state write fails, retrying hide should converge to the same final state
- preview refresh must not assume success if the final refetch fails

Restore flow:

- if restore succeeds but preview refetch fails, keep the preview open and show refresh error

### Session and auth failures

- new routes should return standard auth and scope errors
- preview should keep current UI state intact on read failure and show a bounded error

## Edge cases

- Unlinked face with no ranked candidates:
  - show empty candidate state and keep `Hide face` available
- Candidate scores unavailable:
  - show rows without score and keep deterministic ordering
- Missing face crop thumbnail:
  - use placeholder/avatar and keep overlay as the primary locator
- Hiding an unlinked face:
  - allowed directly
- Hiding a currently linked face:
  - unlink first through reused unlink/suppression semantics, then hide
- Restoring a hidden face:
  - returns as unlinked
  - does not restore old links automatically
- Hidden face after rematerialization:
  - stale hidden rows are ignored
  - restored current preview will only show current materialization faces
- Multiple hidden faces on one asset:
  - toggle reveals all hidden faces with muted styling
- Previous/next navigation while candidate picker is open:
  - clear picker state on asset change
- Zoom changes while a face is selected:
  - selection persists by `assetFaceId`
- Selecting a candidate already linked elsewhere on the same asset:
  - candidate row shows same-asset link metadata
  - saving reuses current move/replace semantics and `forceReplace` flow when required
- Hidden faces shown but not active by default:
  - hidden faces never participate in default linked strip or default active summaries

## Test plan

### Schema and helper tests

Add migration and helper coverage for:

- active hidden-state uniqueness per `asset_face_id`
- restore marking active row inactive
- stale hidden-state cleanup or ignore behavior when materialization changes

### Read-model tests

Add tests for:

- `preview-faces` returning mixed face states:
  - linked manual
  - linked auto
  - unlinked
  - hidden
- `preview-faces` including hidden faces with state flags
- active summary counts excluding hidden faces
- linked strip input excluding hidden faces

### Candidate route tests

Add tests for:

- ranked ordering from current compare rows
- secondary ordering from likely-candidate rows
- final fallback ordering from active signed consents
- exclusion of revoked consents
- exclusion of face-suppressed consents
- inclusion of `currentAssetLink` metadata for same-asset warnings

### Write-flow tests

Add tests for:

- save-confirm linking from an unlinked face through the existing manual-link route
- hide of an unlinked face
- hide of an auto-linked face
- hide of a manually linked face
- restore behavior returning the face as unlinked
- duplicate hide and duplicate restore idempotency

### Hidden-aware filtering tests

Add tests for:

- `listLinkedFaceOverlaysForAssetIds(...)` excluding hidden faces
- `listPhotoConsentAssignmentsForAssetIds(...)` excluding hidden faces
- asset-grid linked counts and linked people summaries excluding hidden faces
- `resolveLikelyCandidateBatch(...)` ignoring hidden faces
- `reconcilePhotoFaceCanonicalStateForAsset(...)` ignoring hidden faces as auto contenders

### UI interaction tests

Add focused component tests for:

- selecting linked vs unlinked vs hidden faces
- candidate tray opening only for unlinked faces
- right-side panel opening only for linked faces
- restore tray opening only for hidden faces
- `show hidden faces` toggle behavior
- existing overlay hover/selection behavior remaining intact

### Regression coverage

Keep or extend regression tests to ensure:

- existing overlay geometry math is unchanged
- existing 044 linked-face panel behavior still works
- existing manual-link precedence and `forceReplace` behavior are not broken

## Implementation phases

### Phase 1: Hidden-face schema and server helpers

- add `asset_face_hidden_states`
- add RLS policies and indexes
- add helper functions for:
  - load current hidden faces
  - hide face
  - restore face
  - hidden-state current-materialization filtering
- add focused tests for helper behavior

### Phase 2: Preview face and candidate read routes

- add `GET /api/projects/[projectId]/assets/[assetId]/preview-faces`
- add `GET /api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates`
- add hidden-aware filtering to:
  - linked overlay helper
  - assignment summary helper
  - likely-candidate resolution helper
  - auto reconcile helper
- add tests for mixed-state payloads and candidate ranking

### Phase 3: Preview UI state and mixed-face rendering

- update `ProjectAssetPreviewLightbox` to use `preview-faces`
- add preview-local state for selected face kind and hidden-face toggle
- render linked, unlinked, and hidden face overlays with distinct styling
- keep linked strip and right-side panel behavior for linked faces
- add unlinked-face candidate tray
- add hidden-face restore tray

### Phase 4: Hide, restore, and save actions

- add hide route
- add restore route
- wire save-confirm linking for unlinked faces to the existing manual-link route
- wire hide actions for linked and unlinked faces
- wire restore action for hidden faces
- add refetch-based refresh after writes

### Phase 5: Tests and polish

- add component interaction coverage
- add server helper and route coverage
- add regression tests for hidden-aware filtering and existing 044 behavior
- verify copy, empty states, and error handling

## Scope boundaries

Still out of scope after this plan:

- zero-face fallback/manual-photo integration in this preview
- auto-restoring old hidden links
- durable cross-rematerialization face identity or remap
- generic review-session redesign
- broad matching-system redesign
- overlay engine redesign

## Concise implementation prompt

Implement Feature 045 by extending the existing asset-preview lightbox to work from a new asset-centric `preview-faces` read model that returns all current detected faces with linked, unlinked, and hidden state. Reuse the existing overlay geometry, hover, selection, zoom, and linked-face panel behavior. Add a new materialization-scoped `asset_face_hidden_states` table with reversible soft hidden state, plus focused hide and restore routes for one asset face. Reuse the existing manual-link route unchanged for saving an unlinked face assignment. Add a new face-scoped preview-candidate route that ranks candidates from current compare evidence first, likely-candidate rows second, and remaining active signed consents last with deterministic fallback ordering. Keep zero-face fallback out of this preview surface. Make hidden faces excluded from active preview summaries, linked overlay reads, linked-count summaries, likely-match reads, and auto reconciliation for the hidden face. Add focused regression coverage for mixed-state preview payloads, candidate ordering, hide and restore flows, hidden-aware filtering, tenant/project scoping, and preservation of current Feature 044 overlay behavior.
