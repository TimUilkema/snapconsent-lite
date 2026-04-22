# Feature 064 Research - Whole-Asset Linking for Video Assets

## Inputs reviewed

Core docs reviewed in requested order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`

Prior RPI docs reviewed:

1. `docs/rpi/055-project-participants-and-mixed-consent-intake/research.md`
2. `docs/rpi/055-project-participants-and-mixed-consent-intake/plan.md`
3. `docs/rpi/058-project-local-assignee-bridge-for-profile-backed-matches/research.md`
4. `docs/rpi/058-project-local-assignee-bridge-for-profile-backed-matches/plan.md`
5. `docs/rpi/059-auto-assignment-for-project-scoped-recurring-assignees/research.md`
6. `docs/rpi/059-auto-assignment-for-project-scoped-recurring-assignees/plan.md`
7. `docs/rpi/061-link-consent-to-whole-asset/research.md`
8. `docs/rpi/061-link-consent-to-whole-asset/plan.md`
9. `docs/rpi/062-video-upload-foundation/research.md`
10. `docs/rpi/062-video-upload-foundation/plan.md`
11. `docs/rpi/063-video-asset-preview-playback-and-thumbnails/research.md`
12. `docs/rpi/063-video-asset-preview-playback-and-thumbnails/plan.md`
13. `docs/rpi/031-one-consent-per-face-precedence-rules/research.md`
14. `docs/rpi/031-one-consent-per-face-precedence-rules/plan.md`
15. `docs/rpi/047-manual-face-box-creation-in-asset-preview/research.md`
16. `docs/rpi/047-manual-face-box-creation-in-asset-preview/plan.md`
17. `docs/rpi/048-block-person-assignment-for-faces-without-consent/research.md`
18. `docs/rpi/048-block-person-assignment-for-faces-without-consent/plan.md`

Live implementation and schema reviewed:

- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/project-face-assignees.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/whole-asset-linking.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-links/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-candidates/route.ts`
- `supabase/migrations/20260415210000_058_project_face_assignee_bridge.sql`
- `supabase/migrations/20260416090000_059_generic_face_assignee_suppressions.sql`
- `supabase/migrations/20260421110000_061_asset_assignee_links.sql`
- `supabase/migrations/20260421120000_062_video_asset_type.sql`
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
- `src/lib/projects/project-participants-service.ts`
- `src/lib/profiles/profile-consent-service.ts`
- `src/lib/profiles/profile-headshot-service.ts`
- `src/lib/project-export/project-export.ts`
- `tests/feature-058-project-local-assignee-bridge.test.ts`
- `tests/feature-062-video-upload-foundation.test.ts`
- `tests/feature-063-video-asset-preview-playback-and-thumbnails.test.ts`

Requested test files `tests/feature-059-auto-assignment-for-project-scoped-recurring-assignees.test.ts` and `tests/feature-061-link-consent-to-whole-asset.test.ts` do not exist in the live repository. The current behavior boundary is anchored by the live files above, especially `feature-058`, `feature-062`, and `feature-063`.

Live code and schema were treated as source of truth where they differ from older docs.

## Verified current whole-asset/video boundary

### What exists today

- Feature 061 introduced whole-asset assignee linking through `asset_assignee_links`.
- Whole-asset links point to `project_face_assignees`, not directly to consents or participants.
- The assignee model already supports both:
  - one-off project consent assignees (`project_consent`)
  - recurring project-consent-backed assignees (`project_recurring_consent`)
- The whole-asset write path already supports both one-off and recurring manual linking.
- Feature 062 widened `assets.asset_type` to include `video`.
- Feature 063 added video playback/poster support in the asset list and preview lightbox.

### What is generic already

- `asset_assignee_links` is schema-generic by `asset_id` and `project_face_assignee_id`.
- There is no schema constraint limiting `asset_assignee_links` to `photo`.
- The uniqueness model is asset plus assignee, so multiple assignees can coexist on the same asset.
- `project_face_assignees` is already the project-scoped identity layer intended to be reused across linking modes.
- The export model already has a generic `whole_asset` link mode in its metadata shape.

### What is still photo-only in live code

- `src/lib/matching/whole-asset-linking.ts` uses `requireWholeAssetPhoto(...)`, which rejects any non-photo asset before link/unlink work proceeds.
- `src/lib/matching/asset-preview-linking.ts` uses `requirePhotoAsset(...)` for whole-asset candidate reads, so `GET /whole-asset-candidates` is effectively photo-only.
- `getAssetPreviewFaces(...)` remains photo-centric and is explicitly rejected for video in the Feature 063 test coverage.
- The photo lightbox includes whole-asset linked-owner UI and create/unlink actions.
- The video lightbox is playback-only and has no whole-asset linking UI.

### What video preview does today

- The project assets route returns both photo and video assets.
- Video assets in the list get poster and playback URLs.
- The shared lightbox router branches to `ProjectVideoAssetPreviewLightbox` for video.
- That video branch currently renders playback controls only. It does not fetch or display assignee links, candidate pickers, or unlink actions.

### Current export/downstream boundary

- `src/lib/project-export/project-export.ts` still loads only `assets.asset_type = 'photo'`.
- Whole-asset export metadata exists, but current export assembly is still photo-only at the asset query boundary.
- As a result, video whole-asset links would not participate in export today even though the metadata model could represent them.

## Current schema, routes, helpers, and components involved

### Schema and identity model

- `project_face_assignees`
  - project-scoped assignee identity layer
  - supports `project_consent` and `project_recurring_consent`
  - preserves tenant and project scoping
- `asset_assignee_links`
  - manual whole-asset link table
  - unique per asset and assignee
  - generic enough for photo and video assets

### Server helpers

- `src/lib/matching/project-face-assignees.ts`
  - resolves or creates project-scoped assignee records
  - recurring assignees are gated by active signed project recurring consent
- `src/lib/matching/whole-asset-linking.ts`
  - server-authoritative create and remove helpers
  - already handles one-off and recurring assignees
  - currently blocked by photo-only asset validation
- `src/lib/matching/asset-preview-linking.ts`
  - builds whole-asset candidate lists
  - includes current whole-asset links in photo preview reads
  - candidate rows already include current exact-face link and current whole-asset link state

### Routes

- `POST/DELETE /api/projects/[projectId]/assets/[assetId]/whole-asset-links`
  - current manual link and unlink route
  - already server-side and tenant-scoped
  - identity payload is generic enough for videos
  - behavior is blocked by photo-only helper validation
- `GET /api/projects/[projectId]/assets/[assetId]/whole-asset-candidates`
  - returns candidate picker data
  - currently blocked by photo-only asset validation

### UI surfaces

- `src/components/projects/project-photo-asset-preview-lightbox.tsx`
  - existing whole-asset strip and picker UX
  - linked assignees are visible and removable
  - candidate picker already supports one-off and recurring rows
- `src/components/projects/project-video-asset-preview-lightbox.tsx`
  - current video playback surface
  - no linking UI today
- `src/components/projects/assets-list.tsx`
  - shows both photo and video assets
  - no linked-owner summary on video cards today

## Current semantics and how they map to video

### Semantics that should carry forward unchanged

- Whole-asset links should continue to target `project_face_assignees`.
- Both one-off and recurring assignees should be linkable through the same server helpers.
- Writes should remain server-authoritative, tenant-scoped, and idempotent.
- Multiple assignees should be allowed on the same asset.
- Existing links should remain visible even if the linked assignee later becomes revoked or otherwise non-assignable.

### Semantics that remain photo-only

- Exact-face ownership
- Hidden faces
- Blocked faces
- Manual face boxes
- Face-level precedence and reconciliation

These remain photo review concepts. They have no direct role in whole-video linking for Feature 064.

### Exact-face conflict rules on video

- Today, whole-asset writes check for an exact-face link conflict for the same assignee on the same asset.
- For video assets in Feature 064, there is no face-level video linking surface, so this conflict path should be effectively inert.
- The rule can remain in shared helpers as long as video assets simply have no exact-face rows to conflict with.

## Can the existing whole-asset model be reused unchanged for videos?

Short answer: mostly yes at the schema and assignee-model layers, but not fully unchanged at the helper and read-model boundary.

### Reuse that is already valid

- `asset_assignee_links` does not need a schema redesign.
- `project_face_assignees` does not need a redesign.
- One-off and recurring assignee resolution paths already exist and should be reused.
- The candidate picker identity model already matches what video needs.

### Minimal widening still required

- Replace photo-only asset guards in whole-asset helper paths with a previewable uploaded asset guard that allows `photo` and `video`.
- Widen whole-asset candidate reads to allow video assets.
- Add a way for the video preview branch to read current whole-asset links.

### What should not be widened

- Do not widen face preview reads into a fake video face model.
- Do not introduce frame, timeline, or matching concepts into this feature.
- Do not reinterpret hidden, blocked, or manual-face state as asset-level video state.

## Candidate picker reuse assessment

The current whole-asset candidate picker should be reused for video with minimal changes.

### Why reuse is a good fit

- One-off assignee rows are already based on project consents and do not depend on face data.
- Recurring assignee rows are already based on project participants and recurring consent state.
- The recurring blocked reasons still make sense for video:
  - missing recurring consent
  - pending recurring consent
  - revoked recurring consent
- Current picker rows already distinguish:
  - assignable vs non-assignable
  - current exact-face link
  - current whole-asset link

### Photo-specific assumptions to keep contained

- `currentExactFaceLink` is still useful to surface for photos.
- For videos, that field should simply remain empty or absent in practice because exact-face video linking is out of scope.
- The route and helper names can stay whole-asset oriented; they do not need video-specific branching beyond the widened asset validation.

## Options considered

### Option 1: Reuse whole-asset model and add video linking in preview only

- Widen whole-asset read/write helpers to allow uploaded video assets.
- Reuse the current candidate picker route and assignee resolution logic.
- Add linked-owner display plus create/unlink actions to the video lightbox.
- Leave the asset grid/list unchanged.

Pros:

- Smallest coherent vertical slice.
- Reuses the existing 061 foundation directly.
- Avoids broad list-query or export changes.

Cons:

- Video cards in the asset grid would still not summarize current links.

### Option 2: Option 1 plus minimal asset list summary

- Do everything in Option 1.
- Also add a lightweight linked-owner summary or count to video cards in the asset list.

Pros:

- Better parity between preview and list surfaces.
- More discoverable without opening the lightbox.

Cons:

- Requires widening the project assets list read model.
- Pulls list performance and presentation concerns into the same feature.

### Option 3: Broader video review workflow

- Build a video-specific review flow with frame or timeline semantics.

Pros:

- None for the current goal.

Cons:

- Violates the intended scope.
- Introduces a different review model than the product intent for 064.

## Recommended model for Feature 064

Recommend Option 1 as the default 064 slice, with Option 2 explicitly deferred unless plan-phase review finds the grid summary necessary for usability.

### Recommended product model

- For `asset_type = 'video'`, whole-asset linking is the primary consent/linking model.
- Videos use the same project assignee model as photos.
- Users can link one or more assignees to the entire video asset.
- Assignees may be:
  - one-off project consent-backed
  - recurring project-consent-backed
- Unlink remains manual and per-assignee.
- No face/frame/timeline review is introduced.

### Recommended technical model

- Keep `asset_assignee_links` unchanged.
- Keep `project_face_assignees` unchanged.
- Widen whole-asset helper validation from photo-only to previewable uploaded assets (`photo` and `video`).
- Reuse the existing candidate generation logic and routes with that widened validation.
- Add a generic read path for current whole-asset links that the video lightbox can consume.

## Recommended UI fit with current preview and list surfaces

### Preview

The smallest clean UI fit is to reuse the existing photo whole-asset pattern inside the video lightbox:

- show current linked assignees in the same strip or tray pattern used for photos
- provide the same add-link action that opens the existing candidate picker pattern
- provide the same unlink affordance per current linked assignee
- show revoked or otherwise inactive current linked owners with the same owner-state treatment used in photo whole-asset UI

This keeps the mental model consistent: photos have face review plus whole-asset linking, while videos expose only the whole-asset portion.

### List/grid

Recommended for 064: leave the asset list unchanged.

Reasoning:

- The current list already distinguishes video assets via poster/playback behavior.
- The core product need is to create, inspect, and remove whole-asset links while previewing the video.
- List-level owner summaries are useful but not required to validate the whole-asset video model.

If plan phase decides a list change is required, keep it small:

- a simple linked-owner count or short summary
- no new list workflow
- no duplication of the full picker UI in the grid

## Required write/read/model changes

### Write path changes

- Replace the photo-only asset gate in `src/lib/matching/whole-asset-linking.ts` with a shared helper that allows uploaded, non-archived previewable assets.
- Keep route authority server-side:
  - derive tenant from session
  - derive project from route and asset lookup
  - never trust client-provided tenant or assignee scoping
- Preserve idempotent create semantics on `asset_assignee_links`.

### Read path changes

- Widen `getAssetPreviewWholeAssetCandidates(...)` so video assets are eligible.
- Do not widen `getAssetPreviewFaces(...)` into a video review payload.
- Add a dedicated read path for current whole-asset links on an asset, likely one of:
  - `GET` on the existing `whole-asset-links` route
  - a new small server helper plus route dedicated to current whole-asset link summaries

The first option is the more coherent extension because the route already owns create/delete for the same resource.

### UI/component changes

- Extract or reuse the existing whole-asset linked-owner strip and candidate picker behavior from the photo lightbox.
- Render that shared asset-level linking UI in `ProjectVideoAssetPreviewLightbox`.
- Keep playback behavior intact; linking UI should be additive below or beside the existing playback surface.

### i18n changes

- Reuse the existing i18n framework and key structure.
- Add new keys only where video-specific copy is necessary.
- Prefer shared asset-level labels where the same text now applies to both photo and video whole-asset linking.

## Security and reliability considerations

- Tenant scoping must remain enforced in every helper and query.
- Asset identity must be resolved server-side from the authenticated tenant and project.
- Writes should stay retry-safe and idempotent.
- One-off linking must continue to reject revoked consents for new links.
- Recurring linking must continue to reject non-signed or revoked project recurring consent for new links.
- Existing links should remain readable even if the underlying owner state later changes.
- Video support should widen only whole-asset paths, not photo face-review paths.

## Edge cases

- One-off assignee linked to a video, then consent is later revoked
  - existing link should still display with revoked owner state
  - new create should not allow relinking to that revoked consent
- Recurring assignee linked to a video, then recurring project consent is revoked
  - existing link should still display
  - new create should be blocked
- Multiple assignees linked to the same video
  - allowed by current schema and should remain allowed
- Repeated create requests for the same asset and assignee
  - should remain idempotent
- Repeated unlink requests
  - should remain safe
- Archived or not-yet-uploaded video asset
  - should not allow whole-asset linking
- Photo exact-face concepts accidentally leaking into video UI
  - should be prevented by keeping face-preview logic photo-only
- Current export path
  - video assets are still excluded from export today
  - this feature should not silently imply full export parity unless plan explicitly includes a minimal widening

## Explicitly deferred work

- Face detection in videos
- Frame-level or timeline-based review
- Video matching
- Playback redesign
- Asset-level blocked semantics for video
- Exact-face linking for videos
- Broad export redesign
- One-off/profile identity merge redesign
- Consent backend redesign
- Large list/grid workflow changes beyond a minimal optional summary

## Open decisions for the plan phase

1. Should 064 stay preview-only for linked-owner visibility, or is a minimal list summary required in the same cycle?
2. Should current whole-asset links for video be read through `GET /whole-asset-links`, or through a new dedicated summary route?
3. Should the photo lightbox whole-asset UI be extracted into a shared component first, or duplicated minimally and cleaned up later?
4. Do we want any minimal export compatibility in 064, given that export is still photo-only today?
5. How should revoked current linked owners be labeled in the video UI so that the state matches photo behavior and existing i18n conventions?

## Recommended bounded next step

Plan Feature 064 as a narrow widening of Feature 061 onto video assets:

- reuse `project_face_assignees` and `asset_assignee_links` unchanged
- widen whole-asset helper and candidate reads from photo-only to photo-or-video where appropriate
- keep face review and all hidden/blocked/manual-face semantics photo-only
- add the existing whole-asset strip plus create/unlink workflow to the video lightbox
- defer broader list and export work unless the plan phase shows a small, necessary compatibility gap

This is the smallest additive slice that makes uploaded videos usable within the current consent model without committing the product to frame-level review or a new video-specific architecture.
