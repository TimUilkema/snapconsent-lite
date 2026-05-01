# Feature 077 Research - Media Library asset safety and release-detail review context

## Inputs reviewed

Required project inputs, in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `UNCODEXIFY.md`
5. `docs/rpi/README.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/074-project-release-package-and-media-library-placeholder/research.md`
8. `docs/rpi/074-project-release-package-and-media-library-placeholder/plan.md`
9. `docs/rpi/075-project-correction-and-re-release-foundation/research.md`
10. `docs/rpi/075-project-correction-and-re-release-foundation/plan.md`
11. `docs/rpi/076-correction-consent-intake-and-authorization-updates/research.md`
12. `docs/rpi/076-correction-consent-intake-and-authorization-updates/plan.md`

Live implementation and schema inspected after the inputs above:

- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
- `src/components/navigation/protected-nav.tsx`
- `src/app/(protected)/layout.tsx`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/project-releases/media-library-download.ts`
- `src/lib/project-releases/types.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`
- `src/lib/assets/sign-asset-playback.ts`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/components/projects/project-photo-asset-preview-lightbox.tsx`
- `messages/en.json`
- `messages/nl.json`
- `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
- `supabase/migrations/20260424150000_075_project_correction_re_release_foundation.sql`
- `supabase/migrations/20260424170000_076_correction_consent_provenance.sql`
- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-074-media-library-download.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`
- `tests/feature-076-correction-consent-intake-foundation.test.ts`
- `tests/feature-076-correction-provenance-foundation.test.ts`

Current live code and schema are treated as the source of truth. Prior RPI documents were used only as context.

## Verified current Media Library behavior

### List page

Current page: `src/app/(protected)/media-library/page.tsx`

What it shows today:

- Latest published release assets only, one release per project, via `listMediaLibraryAssets`.
- Preview thumbnail or poster when signing succeeds.
- Original filename.
- Asset type and project name.
- Workspace name.
- Release version.
- Linked people count.
- Release created timestamp.
- Two actions: `Open` and direct `Download original`.

What it does not show today:

- No blocked or restricted badge.
- No mixed-scope or revoked-context warning.
- No hidden-face or manual-face indicator.
- No download warning or confirmation before hitting the route.

### Detail page

Current page: `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`

What it shows today:

- Back link to Media Library.
- Signed photo preview or signed video playback.
- Filename, asset type, project, workspace, release version, release created timestamp, linked people count.
- Release summary counts for exact-face links, whole-asset links, fallback links, hidden faces, blocked faces, and manual faces.
- Linked owners list with owner kind, owner status, display name, and email.
- Scope snapshot grouped per linked owner.
- Both `effectiveScopes` and `signedScopes`.

What it does not show today:

- No preview overlays for released photos.
- No visual distinction between linked, blocked, hidden, and manual faces on the image itself.
- No explicit blocked/restricted summary banner.
- No confirmation before downloading originals from the detail view.

### Download route

Current route: `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`

What it does today:

- Accepts `GET`.
- Requires authenticated user context.
- Resolves tenant from the logged-in user server-side.
- Calls `createMediaLibraryAssetDownloadResponse`.
- Authorizes against published release asset access.
- Signs the original storage object with the admin Supabase client.
- Returns a `302` redirect to a short-lived signed URL.

What it does not do today:

- No restricted-asset confirmation parameter.
- No warning response for blocked or cautionary release snapshot states.
- No hard block based on blocked faces, hidden faces, scope outcomes, or revoked owners.

### Permissions and photographer access

Media Library access is still protected in three places:

- Navigation and page visibility: `ProtectedLayout` and `protected-nav` only show Media Library when `permissions.canReviewProjects` is true.
- Server-side authorization: `authorizeMediaLibraryAccess` requires review-capable permissions.
- Database RLS: `app.current_user_can_access_media_library(tenant_id)` only allows `owner`, `admin`, and `reviewer`.

Verified result:

- Photographers are still blocked from Media Library list, detail, and download access.
- Existing tests already assert photographer denial for Feature 074 and should remain intact for Feature 077.

## Current release snapshot shape and available data

### Release tables

`project_releases` currently stores:

- Release identity and versioning.
- Source finalized timestamp and finalized by user.
- Snapshot creation timestamp.
- `project_snapshot`.

`project_release_assets` currently stores:

- Tenant/project/workspace/release references.
- Original file identity and storage location.
- `asset_metadata_snapshot`
- `workspace_snapshot`
- `consent_snapshot`
- `link_snapshot`
- `review_snapshot`
- `scope_snapshot`

RLS is select-only for Media Library readers. No Media Library route currently mutates either release table.

### Snapshot JSON contents

`asset_metadata_snapshot`

- Original file info.
- Photo materialization identity and provider info.
- Face count.
- Source image width and height.
- Source coordinate space.

`workspace_snapshot`

- Project id and name.
- Workspace id, name, and kind.
- Release id, version, created timestamp, and snapshot timestamp.

`consent_snapshot`

- `linkedOwners[]` with assignee id, identity kind, consent ids, participant/profile ids, display name, email, current status, signed timestamp, consent version, and face-match opt-in.
- Aggregate linked people count.

`link_snapshot`

- `exactFaceLinks[]` with `assetFaceId`, `faceRank`, assignee id, identity kind, consent ids, link source, and match confidence.
- `wholeAssetLinks[]` with assignee identity and source.
- `fallbackLinks[]` for manual whole-asset fallback cases.

`review_snapshot`

- `faces[]` with `assetFaceId`, `faceRank`, face source, detection probability, raw `faceBox`, and `faceBoxNormalized`.
- `hiddenFaces[]`
- `blockedFaces[]`
- `faceLinkSuppressions[]`
- `assigneeLinkSuppressions[]`
- `manualFaces[]`

`scope_snapshot`

- `owners[]` keyed by assignee identity.
- Each owner contains `effectiveScopes[]` with label, status, and governing source kind.
- Each owner may contain `signedScopes[]`.

### Snapshot sufficiency findings

Already sufficient for list indicators:

- Blocked faces present.
- Hidden faces present.
- Manual faces present.
- Linked people count.
- Revoked owner present.
- Effective scope outcomes that are not fully granted.

Already sufficient for detail summaries:

- Exact-face, whole-asset, and fallback linking counts.
- Owner identity and consent context.
- Effective scope status per owner.
- Hidden, blocked, and manual counts.

Already sufficient for released photo overlays:

- Face geometry from `review_snapshot.faces`.
- Hidden and blocked state from `review_snapshot`.
- Manual provenance from `review_snapshot.manualFaces` or `faceSource === "manual"`.
- Exact face-to-person mapping from `link_snapshot.exactFaceLinks`.
- Person and consent context from `consent_snapshot.linkedOwners`.
- Effective scope context from `scope_snapshot.owners`.

Missing or ambiguous areas:

- No per-face display name on the exact-face link row itself, but it can be joined by `projectFaceAssigneeId` from `consent_snapshot` and `scope_snapshot`.
- Whole-asset links and fallback links have no face geometry, so they cannot render box overlays.
- Some faces may have missing normalized geometry. Fallback conversion from raw `faceBox` is possible when source image dimensions exist in `asset_metadata_snapshot.photoMaterialization`.
- Blocked reason is narrow today. Snapshot data currently only supports the existing blocked-face semantics, not a broad explanation taxonomy.
- Hidden faces record that they are hidden, but not a more descriptive reason label.

Conclusion: current release snapshots are already sufficient for the main Feature 077 display goals. No schema change is currently justified by the live implementation review.

## Current list, detail, and download code paths involved

Primary list/detail/download code paths:

- List page: `src/app/(protected)/media-library/page.tsx`
- Detail page: `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- Download route: `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
- List query: `listMediaLibraryAssets` in `src/lib/project-releases/project-release-service.ts`
- Detail query: `getReleaseAssetDetail` in `src/lib/project-releases/project-release-service.ts`
- Download authorization and signing: `createMediaLibraryAssetDownloadResponse` in `src/lib/project-releases/media-library-download.ts`
- Photo signing: `src/lib/assets/sign-asset-thumbnails.ts`
- Video signing: `src/lib/assets/sign-asset-playback.ts`

Overlay implementation references worth reusing:

- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/components/projects/project-photo-asset-preview-lightbox.tsx`

These current project preview paths prove the UI patterns already exist for:

- Box overlays over images.
- Visual distinction by face state.
- Linked-person identity chips and scope status tones.

Feature 077 can reuse those ideas against immutable release snapshot data rather than mutable project review tables.

## Current constraints and invariants

Verified invariants from live code and schema:

- Media Library is read-only over immutable release snapshots.
- Release snapshots are built at finalization time from current project state.
- Corrections happen through project correction and re-finalization, not by editing releases.
- Re-finalization creates a new release version and does not mutate prior published release rows.
- Media Library list intentionally shows latest published release per project, while direct detail access still works for historical release assets.
- Downloads currently always target the original stored source object for the released asset snapshot.

These are the non-negotiable boundaries Feature 077 must preserve:

- No mutation of release snapshots.
- No mutation of project review state from Media Library.
- No mutation of consent, links, blocked state, hidden state, or manual-face state from Media Library.
- No change to correction or finalization semantics.

## Blocked and restricted indicator findings

### Deriving blocked faces present

This is straightforward from immutable snapshot data:

- `review_snapshot.blockedFaces.length > 0`

### Recommended caution model

Recommended distinction:

- `blocked`: blocked faces present. This is the strongest cautionary state.
- `restricted`: at least one linked owner is revoked, or at least one effective scope is `revoked`, `not_granted`, or `not_collected`.
- `warning/context`: hidden faces present.
- `context only`: manual faces present.

Reasoning:

- Blocked faces represent an explicit release-review restriction signal.
- Effective scopes are the clearest immutable representation of whether released face-linked usage is fully allowed.
- Hidden faces matter for reviewer understanding, but hidden does not necessarily mean the asset should be blocked from release display.
- Manual faces are important provenance and confidence context, not necessarily a release safety failure.

### What list vs detail should show

List page should stay compact:

- Small state chips or badges for `Blocked`, `Restricted`, `Hidden`, and possibly `Manual`.
- Avoid raw count explosions on the list.
- Preserve current filename-first functional layout.

Detail page should be explicit:

- Top summary banner for blocked/restricted context.
- Existing counts plus clearer labels.
- Owner-by-owner consent and effective scope context.
- Face overlay legend for released photos.

## Overlay feasibility findings

### Is the snapshot sufficient for overlays?

Yes for photos, with current data.

Usable immutable inputs:

- Geometry: `review_snapshot.faces[*].faceBoxNormalized`
- Fallback geometry: `review_snapshot.faces[*].faceBox` plus source image dimensions from `asset_metadata_snapshot`
- Hidden state: `review_snapshot.hiddenFaces`
- Blocked state: `review_snapshot.blockedFaces`
- Manual provenance: `review_snapshot.manualFaces` and `faceSource`
- Exact face links: `link_snapshot.exactFaceLinks`
- Owner and consent context: `consent_snapshot.linkedOwners`
- Effective scope context: `scope_snapshot.owners`

### Can linked faces be mapped to person and consent context?

Yes.

Join path:

- `exactFaceLinks.projectFaceAssigneeId`
- to `consent_snapshot.linkedOwners.projectFaceAssigneeId`
- and `scope_snapshot.owners.projectFaceAssigneeId`

This is enough to show:

- Person display name and email.
- One-off vs recurring identity kind.
- Active vs revoked owner state.
- Consent version and signed timestamp.
- Effective scope states.

### Can blocked, hidden, and manual faces be visually distinguished?

Yes for photo overlays.

Snapshot-supported distinctions:

- Linked manual vs linked auto.
- Hidden.
- Blocked.
- Unlinked.
- Manual face provenance.

### Are mutable project tables needed?

Not for the released-photo overlay feature if it is implemented from release snapshot data only.

That is the recommended direction. Pulling mutable project review tables into Media Library would weaken the immutable-release boundary and create stale-vs-current ambiguity.

## Effective-scope display findings

Current detail page shows both:

- `effectiveScopes`
- `signedScopes`

Live storage does not need to change to simplify the UI.

Recommended display change:

- Show effective scopes only in Media Library detail.
- Hide signed scopes from this UI surface.
- Keep signed scope data in the snapshot for audit/history and future support/debug needs.

Reasoning:

- Effective scope state is what reviewers need to understand released asset safety.
- Signed scope state is a lower-level audit detail and is already confusing enough that the feature request explicitly calls it out.
- The existing snapshot already preserves signed scope information, so removing it from the UI does not remove it from history.

Suggested terminology:

- Replace "Scope snapshot" plus the effective/signed split with a simpler "Usage permissions" or "Allowed use" grouping in the plan phase.
- Keep the underlying source data unchanged.

## Download warning design options

### Current route behavior

Current route authorizes and redirects directly to a signed original download.

### Option 1: UI confirmation only

Behavior:

- List/detail UI checks release snapshot state.
- Restricted assets show a warning modal or confirmation step before navigating to the download route.

Pros:

- Smallest implementation.
- Does not break existing authorized direct route access.
- Keeps current route contract stable.

Cons:

- Direct route hits, bookmarks, or copied URLs bypass the UI warning.

### Option 2: UI confirmation plus bounded route confirmation parameter

Behavior:

- UI shows confirmation first.
- Route requires an explicit confirmation query parameter for restricted assets, for example `?confirm=1`.

Pros:

- Stronger safety boundary for direct downloads.
- Prevents accidental bypass from in-app direct links.

Cons:

- Changes current route contract.
- Needs careful handling so authorized non-restricted downloads still work normally.
- May surprise users who rely on direct authorized links.

### Recommended bounded direction

Prefer warning and confirmation, not hard block.

Smallest safe recommendation:

- Start with UI confirmation for clearly restricted assets.
- In the plan phase, decide whether route-level confirmation is required for restricted assets only.

Statuses that should trigger the warning:

- Blocked faces present.
- Any linked owner revoked.
- Any effective scope status not equal to `granted`.
- Hidden faces present should likely warn, but with a weaker message than blocked/restricted state.

Manual faces should not trigger download confirmation by themselves.

## Read-only boundary verification

Verified from live code:

- Media Library list page reads only.
- Media Library detail page reads only.
- Media Library download route signs and redirects only.
- No Media Library server action or route mutates release rows or project review state.
- Correction remains the only path to change released asset state, followed by a new release version at re-finalization.

Feature 077 must keep all new work within:

- Read-only list and detail rendering.
- Read-only snapshot-derived overlay rendering.
- Read-only confirmation UI before download.
- At most, a route-level confirmation gate for restricted downloads if the plan phase decides it is necessary.

## UI and i18n implications

Likely pages/components involved:

- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- Possibly a small shared released-asset overlay or warning component under `src/components/`
- `messages/en.json`
- `messages/nl.json`

Minimal i18n additions likely needed:

- List badges for blocked, restricted, hidden, manual.
- Detail summary banner title and body variants.
- Overlay legend labels.
- Linked-face context labels.
- Effective-scope-only section labels.
- Download warning and confirmation copy.

UI direction should remain aligned with `UNCODEXIFY.md`:

- No new dashboard shell.
- No hero layout.
- No decorative card system redesign.
- No DAM-oriented navigation or terminology shift.
- Prefer compact, functional badges, banners, lists, and overlays within the existing page structure.

## Testing implications

Existing tests to extend:

- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-074-media-library-download.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`

New or expanded test coverage needed:

- List indicators for blocked, restricted, hidden, and manual snapshot states.
- Detail-page context banner and summary rendering.
- Released-photo overlays from immutable release snapshot geometry.
- Linked-face person and consent context derived from snapshot joins.
- Effective-scope-only detail UI.
- Download warning and confirmation behavior.
- Photographer denial remains intact.
- Media Library remains read-only and does not mutate release or project review state.

## Options considered

### Option A - UI-only improvements using existing snapshots

Scope:

- Add list/detail indicators.
- Add detail summary banner.
- Add released-photo overlays from snapshot data.
- Simplify scope display to effective scopes only.
- Add download warning or confirmation UI.

Assessment:

- Supported by current snapshot data.
- Preserves immutable release boundary cleanly.
- Smallest and safest direction.

### Option B - Small release snapshot creation additions only if required

Possible reason:

- Only if implementation reveals a specific missing field that prevents a necessary display.

Assessment:

- Current research did not find a required missing field.
- Not recommended at this time.

### Option C - Defer overlays or route-level warning if plan complexity grows

Assessment:

- Reasonable fallback if implementation scope must stay extremely small.
- Not necessary based on current data availability.

## Recommended bounded direction

Recommend Option A.

Feature 077 should be a read-only Media Library improvement that uses existing immutable release snapshots to expose release-review context more clearly:

- Add compact blocked/restricted/context badges on the list page.
- Add a stronger context summary on the detail page.
- Render released-photo overlays from release snapshot geometry and exact face links only.
- Show linked-face person and consent context from snapshot joins.
- Simplify Media Library scope UI to effective scopes only.
- Add download confirmation for restricted assets without turning Media Library into an editing surface.

No release snapshot schema change is currently warranted.

## Risks and tradeoffs

- If route confirmation is not added, direct route access can bypass a UI-only warning.
- If route confirmation is added, current direct-link behavior changes and needs careful compatibility handling.
- Whole-asset and fallback links cannot be shown as face boxes because snapshot geometry does not exist for them.
- Hidden faces need careful wording so the UI communicates caution without implying the asset is editable here.
- Effective-scope-only UI improves clarity but removes an audit detail from this surface, so the plan should preserve access to the underlying snapshot data in code and tests.

## Explicit open decisions for the plan phase

1. Should restricted-download confirmation be UI-only, or also enforced by the download route for restricted assets?
2. Should hidden faces count as full `restricted`, or as a separate lower-severity warning state?
3. Should manual faces appear on the list page, or detail page only?
4. What exact labels should replace the current `Scope snapshot / Effective scopes / Signed scopes` terminology?
5. Should overlay rendering include hidden faces visually, or summarize them outside the image while keeping them suppressed in the overlay?
6. Should whole-asset and fallback links be represented in the overlay legend as non-geometric context, or only in the textual summary?
7. Does the first implementation slice include both list and detail plus download warning, or should overlays be split into a follow-up if the plan needs a tighter PR?
