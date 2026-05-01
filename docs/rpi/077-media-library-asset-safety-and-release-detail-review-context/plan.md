# Feature 077 Plan - Media Library asset safety and release-detail review context

## Inputs and ground truth

Inputs read for this plan phase, in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `UNCODEXIFY.md`
5. `docs/rpi/README.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/research.md`

Targeted live verification completed in the current source of truth:

- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/project-releases/media-library-download.ts`
- `src/lib/project-releases/types.ts`
- `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
- `src/components/projects/previewable-image.tsx`
- `src/lib/matching/asset-preview-linking.ts`
- `messages/en.json`
- `messages/nl.json`
- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-074-media-library-download.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`
- `tests/feature-076-correction-consent-intake-foundation.test.ts`
- `tests/feature-076-correction-provenance-foundation.test.ts`

Ground-truth rule for this plan:

- Live code and schema are authoritative.
- The Feature 077 research document is the primary synthesized source.
- Any conflict resolves in favor of the current implementation and schema.

## Verified current boundary

Current boundary, re-verified from live code:

- Media Library list is still read-only and shows only the latest published release per project.
- Media Library detail still allows direct access to any published historical release asset by id.
- Media Library detail currently reads only `project_release_assets` plus signed preview/playback URLs.
- Media Library download is still `GET -> authorize -> sign source object -> 302 redirect`.
- Media Library access is still reviewer-only via server checks, nav gating, and RLS.
- Photographers are still denied for list, detail, and download.
- Release snapshots remain immutable once published.
- Correction and re-finalization remain the only way to change released state and publish v2+.
- Feature 075 tests still confirm corrected finalization publishes v2 without mutating v1.
- Feature 076 tests still confirm correction provenance stays in correction flows, not Media Library.

Planning consequence:

- Feature 077 must remain read-only.
- Feature 077 must derive all safety and overlay state from release snapshot JSON already stored on `project_release_assets`.
- Feature 077 must not read mutable project review tables for Media Library rendering.

## Options considered

### Option A - UI-only, read-only improvement using existing release snapshots

What it includes:

- List badges.
- Detail safety summary.
- Photo overlays from immutable snapshot geometry.
- Linked-face person and consent context from immutable snapshots.
- Effective-scope-only UI.
- Download confirmation in the UI.

Pros:

- Smallest bounded change.
- No schema migration.
- No release snapshot creation changes.
- No backfill or compatibility work.
- Preserves current route and release semantics.

Cons:

- Direct route hits can bypass the UI warning.

### Option B - UI changes plus route-level confirmation for restricted downloads

What it adds:

- A confirmation query parameter on the download route for restricted assets.

Pros:

- Stronger warning enforcement for direct download hits.

Cons:

- Changes current route contract.
- Creates a worse direct-link experience for restricted assets unless more route/UI work is added.
- Larger change surface for a feature that is meant to stay advisory and read-only.

### Option C - Snapshot schema or release-creation changes

What it would mean:

- Adjust snapshot creation or table shape to add fields for overlays or safety display.

Pros:

- Only relevant if a truly required display field is missing.

Cons:

- Not supported by current evidence.
- Adds migration and fresh-release regeneration cost for no clear gain.

## Recommendation

Choose Option A.

Feature 077 should stay a UI-only, read-only improvement built entirely on existing immutable release snapshots. No snapshot schema change, no release creation change, no correction change, and no finalization change should be part of the implementation.

The download route should keep its current authorization and redirect contract. Warning and confirmation should be handled in the UI only.

## Chosen architecture

### High-level architecture

Feature 077 will be implemented as:

- Pure snapshot-derived view-model helpers in the Media Library domain.
- Read-only UI updates on the Media Library list and detail pages.
- A small client download button wrapper for advisory confirmation.
- No new write routes.
- No release snapshot schema or migration change.

### Planned helper layer

Add a small pure helper module under `src/lib/project-releases/` for read-only Media Library derivations, for example:

- `deriveReleaseAssetSafetySummary(row)`
- `buildReleaseAssetPhotoOverlayModel(row)`
- `buildReleaseAssetUsageSummary(row)`

These helpers should accept `ProjectReleaseAssetRow` and return serializable derived data only.

Why this architecture:

- It keeps the logic server-side and snapshot-driven.
- It avoids duplicating derivation logic in list, detail, and tests.
- It makes read-only invariants explicit and easy to test.

### Snapshot creation and schema decision

No release snapshot creation change is planned.

No schema migration is planned.

Reason:

- The current snapshots already contain enough data for blocked/restricted indicators, low-level hidden/manual/suppressed context, linked-face owner context, effective-scope rendering, and photo overlays.

## Exact safety indicator model

### Derived counts and booleans

For each `ProjectReleaseAssetRow`, derive:

- `blockedFaceCount = row.review_snapshot.blockedFaces.length`
- `hiddenFaceCount = row.review_snapshot.hiddenFaces.length`
- `suppressedFaceCount = distinct assetFaceIds across row.review_snapshot.faceLinkSuppressions and row.review_snapshot.assigneeLinkSuppressions`
- `manualFaceIds = unique assetFaceIds from row.review_snapshot.manualFaces plus any row.review_snapshot.faces with faceSource === "manual"`
- `manualFaceCount = manualFaceIds.size`
- `revokedLinkedOwnerCount = row.consent_snapshot.linkedOwners.filter((owner) => owner.currentStatus === "revoked").length`
- `nonGrantedEffectiveScopeCount = flatten(row.scope_snapshot.owners[*].effectiveScopes).filter((scope) => scope.status !== "granted").length`
- `nonGrantedEffectiveScopeOwnerCount = distinct owner count where any effective scope status !== "granted"`

Derived booleans:

- `hasBlockedFaces = blockedFaceCount > 0`
- `hasHiddenFaces = hiddenFaceCount > 0`
- `hasSuppressedFaces = suppressedFaceCount > 0`
- `hasManualFaces = manualFaceCount > 0`
- `hasRevokedLinkedOwners = revokedLinkedOwnerCount > 0`
- `hasNonGrantedEffectiveScopes = nonGrantedEffectiveScopeCount > 0`
- `hasRestrictedState = hasRevokedLinkedOwners || hasNonGrantedEffectiveScopes`
- `hasLowLevelReviewContext = hasHiddenFaces || hasSuppressedFaces || hasManualFaces`
- `requiresDownloadConfirmation = hasBlockedFaces || hasRestrictedState`

### Severity levels

Use one primary severity plus supporting badges:

- `blocked`
  - Trigger: `hasBlockedFaces`
  - Meaning: strongest warning
- `restricted`
  - Trigger: `!hasBlockedFaces && hasRestrictedState`
  - Meaning: linked owners or usage permissions include revoked or non-granted states
- `clear`
  - Trigger: none of the above

Supporting badges are independent and ordered:

1. `Blocked`
2. `Restricted`
3. `Manual`

Additional display rule:

- Hidden faces and suppressed faces are read-only review context only.
- Hidden faces and suppressed faces are not restricted state.
- Hidden faces and suppressed faces do not create warning badges.
- Manual faces are provenance/context only and do not create restricted state or download confirmation by themselves.

### Decision for `not_collected`

`not_collected` counts as `restricted` in the Media Library.

Reason:

- Effective permission is not granted.
- Feature 077 is about making released-state caution visible.
- Treating `not_collected` as a weaker non-restricted state would hide an important usage gap.

Display nuance:

- The overall list/detail badge is still `Restricted`.
- The per-scope row keeps the precise status label `Not collected`.

### List page display

List page should remain compact and filename-first.

List changes:

- Add a small badge row near the filename/meta area.
- Show `Blocked`, `Restricted`, and optionally `Manual` if the final UI still benefits from provenance context at list level.
- Keep existing linked people count, workspace, release version, and release created fields.
- Do not add owner-by-owner detail to the list.
- Do not add raw counts to the list badges.
- Do not show `Hidden` or suppressed-state badges in the compact list.

### Detail page display

Detail page should show:

- A top safety banner above the current summary card or preview area when the asset is blocked or restricted.
- Existing summary counts, expanded with clearer labels and grouped meaning.
- Owner-by-owner permission context.
- Overlay legend for photo assets.
- Low-level read-only review context for hidden, suppressed, and manual snapshot state where useful.

Banner logic:

- If `hasBlockedFaces`, show a blocking-style warning banner.
- Else if `hasRestrictedState`, show a restricted warning banner.
- Banner text should explicitly say Media Library is read-only and corrections require the correction flow and a new release.
- Do not show a warning banner for hidden-only, suppressed-only, or manual-only state.
- If hidden or suppressed snapshot state is shown, present it only as low-level review context, not as safety/restriction state.
- Manual-only state may be shown as provenance/context, but should not look like a warning.

## Exact overlay model

### Scope

Overlay rendering is photo-only.

For videos:

- Keep current signed video playback and poster behavior.
- Show the same safety banner and textual summaries.
- Do not attempt overlays.

### Overlay source rule

All overlay data must be derived from the immutable release snapshot stored on `project_release_assets`.

Do not query:

- mutable face tables
- hidden-face tables
- blocked-face tables
- current link tables
- current scope tables

Existing project overlay UI is reference only for rendering patterns, not as a mutable data source.

Suppressed-state rule:

- `faceLinkSuppressions` and `assigneeLinkSuppressions` are low-level snapshot context only.
- Suppressed state does not create warning badges, warning banners, download confirmation, or overlay warning tones.

### Overlay adapter inputs

Build overlay rows from:

- `row.review_snapshot.faces`
- `row.review_snapshot.hiddenFaces`
- `row.review_snapshot.blockedFaces`
- `row.review_snapshot.manualFaces`
- `row.link_snapshot.exactFaceLinks`
- `row.consent_snapshot.linkedOwners`
- `row.scope_snapshot.owners`
- `row.asset_metadata_snapshot.photoMaterialization`

### Geometry resolution

For each face in `row.review_snapshot.faces`:

1. Use `face.faceBoxNormalized` when present.
2. Else, if raw `face.faceBox` exists and `sourceImageWidth` and `sourceImageHeight` exist, normalize from raw coordinates.
3. Else, omit that face from overlay rendering and keep it in textual counts only.

No schema change is planned for missing-geometry cases.

### Face state precedence

Overlay state precedence for a single face:

1. `blocked`
2. `linked_manual`
3. `linked_auto`
4. `manual_unlinked`
5. `unlinked`

Tone mapping to existing overlay rendering primitives:

- `blocked -> tone: "blocked"`
- `linked_manual -> tone: "manual"`
- `linked_auto -> tone: "auto"`
- `manual_unlinked -> tone: "manual"`
- `unlinked -> tone: "unlinked"`

Hidden-face direction:

- Omit hidden faces from the normal overlay.
- Keep hidden-face counts in the textual read-only review context only.

Suppressed-face direction:

- Suppressed faces do not create overlay warning tones.
- Suppression stays textual/contextual only if surfaced at all.

Reason:

- Hidden and suppressed faces are intentionally removed from normal consideration.
- The released preview should focus on considered faces.
- Blocked faces still need to remain visible in overlays when geometry exists.

### Exact-face owner mapping

Map face-level person and consent context by:

1. Index `link_snapshot.exactFaceLinks` by `assetFaceId`
2. Join linked owner data by `projectFaceAssigneeId` from `consent_snapshot.linkedOwners`
3. Join effective scope data by `projectFaceAssigneeId` from `scope_snapshot.owners`

For a linked face overlay, expose:

- display name
- email
- identity kind
- owner active/revoked state
- link source manual/auto
- match confidence when present
- effective scope statuses for that owner

### Whole-asset and fallback link handling

Whole-asset links and fallback links do not have face geometry.

Plan:

- Keep them in textual summary only.
- Do not fabricate face boxes for them.
- Mention them in the detail summary and owner/permission sections.

### Overlay rendering primitive

Use the existing image overlay rendering primitive in `src/components/projects/previewable-image.tsx` for contained-image box positioning, but feed it only release-snapshot-derived overlay data.

Planned detail-page wrapper:

- A small Media Library-specific read-only photo preview component, for example `src/components/media-library/release-photo-preview.tsx`
- This wrapper prepares `PreviewFaceOverlay[]` from the snapshot adapter and keeps the interaction read-only

Interaction plan:

- Overlay clicks may scroll to an in-page face/context row or simply remain non-mutating anchors.
- No edit or review actions are exposed.

## Exact effective-scope UI plan

### Storage decision

Keep `signedScopes` in release snapshots unchanged.

Do not display `signedScopes` in the Media Library UI.

### Final Media Library label

Replace the current scope section label with:

- `Usage permissions`

Why:

- It is clearer product language than `Scope snapshot`.
- It focuses reviewers on effective released-state meaning rather than storage structure.

### Detail rendering

For each linked owner:

- Show owner name, owner kind, and owner active/revoked status.
- Show effective scope rows only.
- Render scope statuses with explicit labels:
  - `Granted`
  - `Not granted`
  - `Revoked`
  - `Not collected`

Status ordering within an owner card:

1. `revoked`
2. `not_granted`
3. `not_collected`
4. `granted`

Why:

- It surfaces cautionary scope states first without changing underlying data.

Tone guidance:

- `revoked`: red
- `not_granted`: amber
- `not_collected`: amber
- `granted`: neutral/green depending on current design language

### Banner linkage

If `hasRestrictedState`, the detail banner should summarize why:

- revoked linked owners
- non-granted effective permissions

The banner should not mention `signedScopes`.

## Exact download warning and confirmation plan

### Chosen behavior

Choose UI-only confirmation.

The download route remains unchanged:

- same `GET`
- same authorization path
- same server-side tenant resolution
- same server-side signed URL creation
- same `302` redirect

### Why UI-only is chosen

- Smallest bounded change.
- Preserves current direct authorized downloads.
- Keeps advisory warning separate from access control.
- Avoids introducing a new error mode for restricted direct links.

### States that trigger confirmation

Trigger confirmation when:

- `hasBlockedFaces`
- or `hasRestrictedState`

Do not trigger confirmation for `manual` alone.
Do not trigger confirmation for hidden-only or suppressed-only state.

### UI behavior

Add a small client component, for example:

- `src/components/media-library/media-library-download-button.tsx`

Behavior:

- If `requiresDownloadConfirmation` is false, render the current direct download interaction.
- If `requiresDownloadConfirmation` is true, intercept click and show a localized `window.confirm(...)`.
- On confirm, navigate to the existing download URL.
- On cancel, do nothing.

Why `window.confirm` is acceptable here:

- It is bounded.
- It avoids adding a larger modal system for an advisory step.
- It keeps the UI normal and functional.

Confirmation copy should vary by severity:

- blocked: strongest warning
- restricted: permission/revocation warning

### Server-side safety

No client-supplied bucket/path values are accepted.

The route must continue to resolve storage coordinates from the release asset row server-side.

## Exact UI, component, and i18n plan

### Pages to change

- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`

### Planned new shared components

- `src/components/media-library/release-safety-badges.tsx`
- `src/components/media-library/release-safety-banner.tsx`
- `src/components/media-library/media-library-download-button.tsx`
- `src/components/media-library/release-photo-preview.tsx`
- `src/components/media-library/release-usage-permissions.tsx`

### Planned helper modules

- `src/lib/project-releases/media-library-release-safety.ts`
- `src/lib/project-releases/media-library-release-overlays.ts`

The exact filenames may shift slightly, but the responsibilities should stay separate:

- safety summary derivation
- overlay derivation
- read-only UI rendering

### List page plan

Keep the current structure.

Changes:

- Insert safety badges under the filename/type line or above the action row.
- Replace the direct anchor with the new download button wrapper.
- Do not alter latest-release-per-project behavior.

### Detail page plan

Keep the current two-column structure.

Changes:

- Add a top safety banner only for blocked or restricted state.
- Replace the plain photo image with the read-only released-photo preview component when the asset is a photo.
- Keep current video rendering unchanged.
- Replace `Scope snapshot` and the effective/signed split with `Usage permissions` and effective scopes only.
- Replace the direct anchor with the new download button wrapper.

### i18n plan

Additive keys only. Reuse the existing `mediaLibrary.list` and `mediaLibrary.detail` namespaces.

Planned `mediaLibrary.list` additions:

- `badges.blocked`
- `badges.restricted`
- `badges.manual`
- `downloadWarnings.blocked`
- `downloadWarnings.restricted`

Planned `mediaLibrary.detail` additions:

- `sections.usagePermissions`
- `safety.title.blocked`
- `safety.title.restricted`
- `safety.body.blocked`
- `safety.body.restricted`
- `safety.readOnlyNote`
- `overlay.legend.linkedAuto`
- `overlay.legend.linkedManual`
- `overlay.legend.blocked`
- `overlay.legend.manual`
- `overlay.legend.unlinked`
- `reviewContext.hiddenFaces`
- `reviewContext.suppressedFaces`
- `reviewContext.manualFaces`
- `overlay.emptyGeometry`
- `download.confirmTitle`
- `download.confirmBodyBlocked`
- `download.confirmBodyRestricted`
- `download.confirmAction`
- `download.cancelAction`
- `linkedFace.identity.project_consent`
- `linkedFace.identity.project_recurring_consent`
- `linkedFace.ownerStatus.active`
- `linkedFace.ownerStatus.revoked`

Translation work:

- Update both `messages/en.json` and `messages/nl.json`.
- Keep stored snapshot and consent data unchanged.

## Security and read-only considerations

The implementation must preserve:

- No mutation of `project_releases`
- No mutation of `project_release_assets`
- No mutation of project review state
- No mutation of consent or link state
- No mutation of correction state
- No mutation of finalization behavior
- No mutation of release versioning behavior

No change is planned for:

- Media Library RLS
- `app.current_user_can_access_media_library`
- reviewer-only authorization
- photographer denial

No new write route is planned.

No new server action is planned.

Correction remains the only path to change released state, followed by a new release version.

## Edge cases

- Historical detail by release asset id stays valid and unchanged.
- Latest-only list behavior stays unchanged.
- Photos with no preview URL still show summary and safety/banner state.
- Videos never show face overlays.
- Faces without usable geometry remain counted in summaries but omitted from overlay rendering.
- Whole-asset links and fallback links remain textual only.
- Hidden faces are omitted from the normal overlay even when geometry exists.
- Suppressed faces are not warning state and do not create overlay warning tones.
- A face that is both hidden and blocked is omitted from the normal overlay, but blocked still contributes to safety summary and advisory download confirmation.
- Manual faces that are also linked use manual tone, not auto.
- Owners with no effective scopes still render an empty-state message in `Usage permissions`.
- `not_collected` scopes count as restricted for warnings and badges.
- Download confirmation is advisory only; route authorization remains the actual security boundary.
- No compatibility or backfill work is planned for arbitrary old local snapshot rows because the chosen architecture is UI-only.

## Test plan

### Existing tests to extend

- `tests/feature-074-project-release-media-library.test.ts`
  - keep latest-release list behavior
  - keep historical detail access
  - keep photographer denial
- `tests/feature-074-media-library-download.test.ts`
  - keep current route authorization and redirect contract
  - keep missing-source behavior
- `tests/feature-075-project-correction-workflow.test.ts`
  - keep v2 without mutating v1

### New test coverage

Add focused Feature 077 tests for pure helpers and UI rendering, for example:

- `tests/feature-077-media-library-view-model.test.ts`
  - derives blocked/restricted/manual and low-level hidden/suppressed context from snapshot data
  - treats `not_collected` as restricted
  - derives download confirmation correctly
  - derives overlay rows from snapshot data only
  - falls back from raw geometry to normalized geometry
  - omits overlays when geometry is unavailable
  - omits hidden faces from the normal overlay
  - does not treat suppressed faces as restricted or warning state

- `tests/feature-077-media-library-ui.test.tsx`
  - list badges render in the right order
  - detail safety banner renders the right severity
  - usage permissions show effective scopes only
  - signed scopes are hidden from Media Library UI
  - linked-face owner/consent context renders from snapshot joins
  - blocked and restricted assets trigger advisory download confirmation
  - hidden-only assets do not show list warning badges
  - hidden-only assets do not show warning banners
  - hidden-only assets do not trigger download confirmation
  - suppressed-only assets do not show warning banners or download confirmation
  - download button does not confirm for manual-only state
  - authorized users can still proceed with download after confirming blocked/restricted downloads

### Regression expectations

Keep the following explicit regressions covered:

- photographers remain denied
- Media Library stays latest-only in list
- historical direct detail access remains
- route still returns `302` for authorized downloads
- no schema migration is required for the chosen plan
- no Media Library path mutates release or project state

## Implementation phases

### Phase 1 - Pure snapshot-derived view-model helpers

Work:

- Add read-only safety derivation helper.
- Add read-only overlay derivation helper.
- Add unit tests for counts, booleans, severity, owner joins, scope status handling, and geometry fallback.

Exit criteria:

- No UI changes yet.
- Helper outputs are stable and well-tested.

### Phase 2 - List badges and detail safety summary

Work:

- Add safety badges to the list page.
- Add safety banner to the detail page only for blocked/restricted state.
- Add the read-only download button wrapper using UI confirmation.
- Keep existing page structure intact.
- Add UI tests for list/detail badges and banner behavior.

Exit criteria:

- Media Library state is clearer without overlays yet.

### Phase 3 - Effective-scope-only usage permissions

Work:

- Replace `Scope snapshot` with `Usage permissions`.
- Remove `signedScopes` from Media Library rendering.
- Keep effective scopes only.
- Add tests verifying signed scopes remain hidden in the UI.

Exit criteria:

- Media Library uses clearer product language for permissions.

### Phase 4 - Released photo overlays

Work:

- Add read-only photo overlay rendering from release snapshots.
- Add linked-face owner/context presentation.
- Keep whole-asset and fallback links textual only.
- Add tests for overlay derivation and rendering.

Exit criteria:

- Released-photo detail clearly shows linked, blocked, manual, and unlinked geometry where available, while hidden faces stay out of the normal overlay.

### Phase 5 - Regression pass

Work:

- Re-run and extend relevant Feature 074/075 regressions.
- Confirm no RLS, correction, or finalization behavior changed.
- Confirm no migration/backfill work was introduced.

Exit criteria:

- Feature 077 remains bounded and read-only.

## Scope boundaries

Still in scope:

- list badges
- detail safety summary
- read-only photo overlays from snapshot geometry
- linked-face person/consent context from snapshots
- effective-scope-only Media Library UI
- UI download confirmation
- i18n updates
- tests

Still out of scope:

- editing release snapshots
- editing project review state from Media Library
- changing consent, link, blocked, hidden, or manual-face state
- changing correction behavior
- changing finalization behavior
- changing release versioning behavior
- folders or collections
- DAM sync or DAM schema
- public sharing
- release diff/history UI
- upload during correction
- export redesign
- compatibility or backfill work for arbitrary old local data

## Concise implementation prompt

Implement Feature 077 as a read-only Media Library improvement using only immutable `project_release_assets` snapshot data. Add snapshot-derived safety badges to the Media Library list, a stronger safety banner to the detail page for blocked or restricted state, effective-scope-only `Usage permissions`, and photo-only overlays derived from `review_snapshot`, `link_snapshot`, `consent_snapshot`, `scope_snapshot`, and `asset_metadata_snapshot`. Keep hidden and suppressed faces as low-level read-only review context only: no warning badges, no warning banners, and no download confirmation from hidden-only or suppressed-only state. Keep latest-release list behavior, historical detail access, reviewer-only access, and the existing download route contract unchanged. Add a small client download button that uses localized advisory confirmation for blocked or restricted state only, but do not add any write path, schema change, release snapshot change, correction change, or finalization change.
