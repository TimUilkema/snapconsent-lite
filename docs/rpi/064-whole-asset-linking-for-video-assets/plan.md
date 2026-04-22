# Feature 064 Plan - Whole-Asset Linking for Video Assets

## Inputs and ground truth

Read in the required order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/064-whole-asset-linking-for-video-assets/research.md`

Targeted live verification only:

- whole-asset storage and helpers
  - `src/lib/matching/whole-asset-linking.ts`
  - `src/lib/matching/project-face-assignees.ts`
  - `src/lib/matching/asset-preview-linking.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-links/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-candidates/route.ts`
  - `supabase/migrations/20260415210000_058_project_face_assignee_bridge.sql`
  - `supabase/migrations/20260416090000_059_generic_face_assignee_suppressions.sql`
  - `supabase/migrations/20260421110000_061_asset_assignee_links.sql`
- video asset and preview boundary
  - `src/lib/assets/create-asset.ts`
  - `src/lib/assets/finalize-asset.ts`
  - `src/lib/assets/post-finalize-processing.ts`
  - `src/app/api/projects/[projectId]/assets/route.ts`
  - `src/app/(protected)/projects/[projectId]/page.tsx`
  - `src/components/projects/assets-list.tsx`
  - `src/components/projects/project-asset-preview-lightbox.tsx`
  - `src/components/projects/project-photo-asset-preview-lightbox.tsx`
  - `src/components/projects/project-video-asset-preview-lightbox.tsx`
  - `src/components/projects/previewable-image.tsx`
  - `src/lib/assets/sign-asset-playback.ts`
  - `supabase/migrations/20260421120000_062_video_asset_type.sql`
- project participation and recurring consent surfaces
  - `src/lib/projects/project-participants-service.ts`
  - `src/lib/profiles/profile-consent-service.ts`
  - `src/lib/profiles/profile-headshot-service.ts`
- downstream seam
  - `src/lib/project-export/project-export.ts`
- boundary tests
  - `tests/feature-058-project-local-assignee-bridge.test.ts`
  - `tests/feature-062-video-upload-foundation.test.ts`
  - `tests/feature-063-video-asset-preview-playback-and-thumbnails.test.ts`

Feature 064 research is the primary synthesized source. Live code and schema remain final authority.

## Verified current planning boundary

- `asset_assignee_links` is already generic by asset and assignee. No schema redesign is needed.
- `project_face_assignees` already supports both one-off (`project_consent`) and recurring (`project_recurring_consent`) assignees. No new identity model is needed.
- whole-asset writes are currently blocked by `requireWholeAssetPhoto(...)` in `src/lib/matching/whole-asset-linking.ts`.
- whole-asset candidate reads are currently blocked by `requirePhotoAsset(...)` in `src/lib/matching/asset-preview-linking.ts`.
- `GET /whole-asset-candidates` already exists and can be reused once its asset gate is widened.
- `whole-asset-links` currently exposes `POST` and `DELETE` only. There is no `GET` today.
- photo preview already has a distinct whole-asset strip plus right-side whole-asset panel inside `src/components/projects/project-photo-asset-preview-lightbox.tsx`.
- video preview currently renders playback only in `src/components/projects/project-video-asset-preview-lightbox.tsx`.
- the project assets list already supports opening video preview, but video cards do not show linked-owner summaries.
- export remains photo-only because `src/lib/project-export/project-export.ts` filters `assets.asset_type = 'photo'`.

## Recommendation

Implement Feature 064 as a narrow extension of Feature 061 onto video assets:

- keep `project_face_assignees` unchanged
- keep `asset_assignee_links` unchanged
- widen only whole-asset helper/read boundaries from photo-only to uploaded previewable assets (`photo` and `video`)
- add a read seam for current whole-asset links on videos by extending the existing `whole-asset-links` route with `GET`
- reuse the existing whole-asset strip and right-side detail/picker UI pattern inside video preview
- keep face review, hidden faces, blocked faces, manual face boxes, and exact-face ownership photo-only
- keep the asset grid and export unchanged in 064

This is the smallest production-oriented slice that makes videos usable within the existing consent model without drifting into video review or export redesign.

## Chosen reuse strategy

### Reuse unchanged

- `project_face_assignees`
- `asset_assignee_links`
- one-off assignee resolution through `ensureProjectConsentFaceAssignee(...)`
- recurring assignee resolution through `ensureProjectRecurringConsentFaceAssignee(...)`
- current route body contract:
  - `identityKind + consentId`
  - or `identityKind + projectProfileParticipantId`
- current whole-asset candidate row model for one-off and recurring assignees
- current whole-asset strip and right-side detail/picker interaction model from photo preview

### Minimal widening required

- replace the photo-only asset gate in whole-asset write helpers with a previewable asset gate that allows `photo` and `video`
- widen whole-asset candidate reads to use the same previewable asset gate
- extract the current whole-asset link summary mapping into a reusable read helper
- expose that helper through `GET /whole-asset-links`
- reuse the shared whole-asset strip/panel UI in the video lightbox

### Intentionally unchanged

- photo face preview APIs stay photo-only
- face linking, hidden faces, blocked faces, and manual-face semantics stay photo-only
- upload/finalize/playback foundations stay unchanged
- export stays photo-only in 064

## Exact semantic model for video whole-asset linking

- For `asset_type = 'video'`, whole-asset linking is the primary linking model in 064.
- Videos can have zero, one, or many whole-asset assignees.
- Both supported assignee kinds work on videos from day one:
  - one-off project consent assignees
  - recurring project-consent-backed assignees
- Unlink is manual and per assignee.
- Exact-face ownership remains a photo-only concept.
- Hidden faces, blocked faces, and manual face boxes have no role in video linking.
- Existing linked owners remain visible if their consent state later becomes revoked.
- New create operations still revalidate eligibility server-side and reject revoked or non-signed states as they do for photos.

## Exact write plan

### Helpers

In `src/lib/matching/whole-asset-linking.ts`:

- rename or replace `requireWholeAssetPhoto(...)` with a helper such as `requireWholeAssetLinkableAsset(...)`
- allowed asset conditions:
  - `asset_type` is `photo` or `video`
  - `status = 'uploaded'`
  - `archived_at is null`
- keep the rest of the write path unchanged:
  - same assignee lookup
  - same exact-face conflict check
  - same idempotent `already_linked` / `already_unlinked` outcomes
  - same tenant and project scoping

### Routes

In `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-links/route.ts`:

- preserve the current request contract exactly
- preserve one-off server validation through `assertConsentInProject(..., { requireNotRevoked: true })`
- preserve recurring participant lookup and server-side revalidation
- no video-specific route branching is required once helper validation is widened

No migration is planned.

## Exact read-model plan

### Decision

Use `GET /api/projects/[projectId]/assets/[assetId]/whole-asset-links` as the read seam for current whole-asset links.

Reasoning:

- it matches the existing resource route
- it avoids creating a separate summary endpoint for the same concept
- it gives video preview a clean way to load current owners without widening face preview APIs

### Read helper

In `src/lib/matching/asset-preview-linking.ts`:

- extract the current whole-asset link summary build logic out of `getAssetPreviewFaces(...)` into a reusable helper, for example:
  - `getAssetPreviewWholeAssetLinks(...)`
- returned shape should be asset-level only, for example:
  - `assetId`
  - `wholeAssetLinkCount`
  - `wholeAssetLinks`
- reuse the same owner summary mapping already used by photo preview:
  - display name
  - email
  - owner state
  - consent summary
  - recurring summary
  - headshot thumbnail/preview URLs
  - `linkMode: "whole_asset"`

### Route contract

Add `GET` to `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-links/route.ts`:

- require auth and tenant/project scope using the same route guard
- return the shared whole-asset link summary payload
- set `Cache-Control: no-store, max-age=0` like the candidate route

### Candidate route reuse

In `src/lib/matching/asset-preview-linking.ts`:

- keep `getAssetPreviewWholeAssetCandidates(...)` as the candidate builder
- change its asset gate from photo-only to previewable uploaded assets
- keep candidate semantics unchanged:
  - one-off rows remain assignable when consent is active
  - recurring rows remain assignable only when project recurring consent is signed
  - blocked reasons remain `missing`, `pending`, or `revoked`
  - `currentExactFaceLink` remains available but is naturally empty for videos
  - `currentWholeAssetLink` continues to indicate already-linked rows

Face-preview APIs stay photo-only:

- `getAssetPreviewFaces(...)`
- face preview candidate routes
- face overlay and face-tray workflows

## Exact preview/UI plan

### Structural approach

Reuse the photo whole-asset UI pattern inside the video lightbox, but do not import any face-review UI.

Recommended UI composition:

- keep the current video dialog header and playback scene
- render the whole-asset strip below the playback scene
- render the current whole-asset detail/picker panel in the same right-side pattern used by photo preview on larger screens
- keep mobile behavior stacked, matching current responsive preview behavior

### UI extraction

Extract the asset-level whole-asset UI from `src/components/projects/project-photo-asset-preview-lightbox.tsx` into a shared module, for example:

- `AssetPreviewWholeAssetStrip`
- `AssetPreviewWholeAssetPanel`

If needed, add a very small shared preview layout wrapper for:

- main scene
- below-scene controls/strip
- right-side panel

Do not extract or reuse:

- linked-face strip
- face overlays
- blocked/hidden trays
- manual face drawing flows

### Video lightbox behavior

In `src/components/projects/project-video-asset-preview-lightbox.tsx`:

- load current whole-asset links from `GET /whole-asset-links`
- load candidates from the existing `GET /whole-asset-candidates`
- show current linked owners in the shared whole-asset strip
- allow selecting an existing linked owner to open the shared detail panel
- allow opening the picker from the shared panel
- allow save/remove through the existing `POST` and `DELETE /whole-asset-links` route
- keep playback controls and loading/error overlays intact

### Refresh behavior

After save or unlink in the video lightbox:

- reload the whole-asset link summary payload
- reload the candidate payload if the picker is open
- keep selected assignee state in sync when possible
- clear stale selection if the linked assignee was removed

### i18n

- reuse current asset-level preview strings where wording is already generic
- add new translation keys only for copy that is video-preview-specific
- update both English and Dutch locale files
- do not hardcode new UI strings in components

## One-off and recurring assignee behavior

### One-off assignees

- current create/delete flow stays unchanged
- one-off video linking uses the existing `identityKind = "project_consent"` path
- new creates must still reject revoked consents
- existing linked one-off owners remain visible if later revoked

### Recurring assignees

- recurring video linking uses the existing `identityKind = "recurring_profile_match"` path
- assignability stays driven by project recurring consent state:
  - `missing`
  - `pending`
  - `signed`
  - `revoked`
- non-assignable rows stay visible in the candidate picker with blocked-reason messaging
- existing linked recurring owners remain visible if later revoked

### Revoked owner display

- reuse the same owner-state labeling already used by the photo whole-asset panel
- do not special-case video-only wording
- keep current link visibility separate from create eligibility

## List/grid decision

Feature 064 stays preview-only for linked-owner visibility.

Reasoning:

- the current asset list already supports opening video preview
- list-level linked-owner summaries for videos are not required to make whole-asset video linking usable
- adding list summary data would widen the assets route and card presentation beyond the smallest coherent slice

Therefore:

- no change to `src/app/api/projects/[projectId]/assets/route.ts` for video linked-owner summaries
- no change to video cards in `src/components/projects/assets-list.tsx`

## Export decision

No export widening in Feature 064.

Reasoning:

- current export is explicitly photo-only at the asset query boundary
- adding video asset export support is a separate downstream decision, not a prerequisite for linking videos in preview
- widening export now would expand the feature into payload shape and downstream compatibility work

Therefore:

- no change to `src/lib/project-export/project-export.ts` in 064
- document that video whole-asset links are intentionally not exported yet

## Security and reliability considerations

- keep all tenant and project scoping server-side
- never accept tenant identity from the client
- validate the asset through server-side lookup before all whole-asset reads and writes
- preserve idempotent create/delete behavior on `asset_assignee_links`
- preserve server-side eligibility checks for both one-off and recurring create operations
- keep exact-face conflict detection in shared write helpers, even though it should not fire for videos in 064
- keep face-preview and face-review code paths separate from video whole-asset flows
- use no-store responses for the new whole-asset read seam to avoid stale owner display

## Edge cases

- linking the same assignee to the same video twice returns `already_linked`
- unlinking an already-removed video link returns `already_unlinked`
- multiple assignees can coexist on the same video
- archived videos remain non-linkable
- not-yet-uploaded videos remain non-linkable
- a linked owner later becomes revoked and still displays as current owner
- recurring participant rows may stay visible but non-assignable due to missing, pending, or revoked project consent
- photo face preview APIs must continue rejecting videos
- photo whole-asset behavior must remain unchanged

## Test plan

### Extend `tests/feature-058-project-local-assignee-bridge.test.ts`

Add coverage for the shared whole-asset model on video assets:

- one-off whole-asset link on a video
- recurring whole-asset link on a video
- multiple assignees on the same video
- duplicate create returning `already_linked`
- duplicate delete returning `already_unlinked`
- existing video whole-asset link remains visible after consent revocation

These tests should hit the same helper layer that already anchors whole-asset behavior today.

### Extend `tests/feature-063-video-asset-preview-playback-and-thumbnails.test.ts`

Add coverage for the video preview boundary:

- `getAssetPreviewFaces(...)` still rejects videos
- `getAssetPreviewWholeAssetCandidates(...)` now accepts videos
- the new whole-asset read seam returns current linked owners for a video
- video preview UI rendering shows whole-asset linked-owner content when supplied with linked-owner data

If the client UI is hard to test directly, extract the shared presentational whole-asset UI so it can be rendered in static markup tests.

### Keep `tests/feature-062-video-upload-foundation.test.ts`

- keep as an unchanged regression anchor for upload/type foundations
- no new 064-specific expectations are required there unless implementation accidentally touches upload/type behavior

### Regression coverage

- photo whole-asset candidate behavior remains unchanged
- photo whole-asset create/delete behavior remains unchanged
- video support does not broaden face review or matching APIs

## Implementation phases

### Phase 1: Helper and route widening

Files:

- `src/lib/matching/whole-asset-linking.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-links/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-candidates/route.ts`

Work:

- introduce shared previewable-asset gating for whole-asset operations
- add `GET /whole-asset-links`
- widen whole-asset candidate reads to video
- keep face preview routes photo-only

### Phase 2: Asset-level read helper extraction

Files:

- `src/lib/matching/asset-preview-linking.ts`

Work:

- extract reusable whole-asset link summary builder from `getAssetPreviewFaces(...)`
- reuse that builder in both photo preview reads and the new `GET /whole-asset-links`

### Phase 3: Shared whole-asset UI reuse in video preview

Files:

- `src/components/projects/project-photo-asset-preview-lightbox.tsx`
- `src/components/projects/project-video-asset-preview-lightbox.tsx`
- optional new shared component file for whole-asset preview UI

Work:

- extract shared whole-asset strip and panel components
- wire video lightbox to the new whole-asset read and candidate routes
- preserve existing playback scene and navigation controls

### Phase 4: Tests and cleanup

Files:

- `tests/feature-058-project-local-assignee-bridge.test.ts`
- `tests/feature-063-video-asset-preview-playback-and-thumbnails.test.ts`
- any locale files touched by new i18n keys

Work:

- add the new server and preview boundary tests
- verify photo behavior remains unchanged
- remove any duplicated whole-asset UI code introduced during extraction

## Explicitly deferred work

- face detection in videos
- frame or timeline review
- video matching
- playback redesign
- exact-face linking for videos
- asset-grid linked-owner summary for videos
- export widening for video assets
- any new video-specific assignee identity model
- any widening of hidden, blocked, or manual-face semantics into video

## Concise implementation prompt

Implement Feature 064 as a bounded widening of Feature 061 onto video assets. Reuse `project_face_assignees` and `asset_assignee_links` unchanged. Widen only the whole-asset helper/read boundary from photo-only to uploaded previewable assets (`photo` and `video`). Add `GET /api/projects/[projectId]/assets/[assetId]/whole-asset-links` backed by extracted whole-asset summary mapping from `asset-preview-linking.ts`. Keep `getAssetPreviewFaces(...)` and all face-review flows photo-only. Reuse the existing whole-asset strip and right-side detail/picker UI pattern from the photo preview in `ProjectVideoAssetPreviewLightbox`, while preserving the current playback experience. Do not change the asset grid or export in 064. Add tests covering one-off and recurring video whole-asset linking, multiple assignees, revoked current-owner display, idempotent create/delete, candidate reuse for video, video preview linked-owner display, and unchanged photo behavior.
