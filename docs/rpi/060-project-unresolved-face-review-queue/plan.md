# Feature 060 Plan: Project Unresolved Face Review Queue

## Goal

Implement the smallest bounded workflow that helps operators find unfinished face-review work, prioritize it, filter it, and jump into the existing lightbox to resolve it quickly.

Feature 060 remains focused on discovery, filtering, prioritization, and navigation. It does not introduce a second face-review system.

## Inputs and ground truth

### Required docs re-read

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/060-project-unresolved-face-review-queue/research.md`

### Targeted live verification used for planning

- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/assets-list.tsx`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/project-face-assignees.ts`
- `tests/feature-044-asset-preview-linking-ux-improvements.test.ts`
- `tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`
- `tests/feature-047-manual-face-box-creation-in-asset-preview.test.ts`
- `tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`
- `tests/feature-058-project-local-assignee-bridge.test.ts`

### Planning ground truth from live code

- `AssetsList` is the existing project asset surface and already owns asset search, pagination, sort state, and lightbox open state.
- `ProjectAssetPreviewLightbox` is already the only real face-resolution surface.
- The lightbox already refreshes its own preview state after writes, but the parent asset list currently refreshes page data immediately after each write.
- `getAssetPreviewFaces(...)` already exposes the exact face states and owner activity state needed for derived review logic.
- Revoked current owners are already meaningful in preview and in tests.
- Manual-created faces already surface as normal preview faces and can be `unlinked`.
- Blocked and hidden are already canonical, separate face states and already tested.
- No current route or helper exposes asset-level unresolved/review status.
- No schema or durable workflow table is required by the current feature boundary.

## Verified current planning boundary

### Existing project assets surface

Verified in `src/app/(protected)/projects/[projectId]/page.tsx` and `src/components/projects/assets-list.tsx`:

- the feature should stay inside the existing project page and `AssetsList`
- there is no current review queue page
- current sorting is limited to created date and file size
- current filters are search plus linked-person filters
- the lightbox is opened from the asset list and navigates previous/next within the current filtered result set

### Existing lightbox boundary

Verified in `src/components/projects/project-asset-preview-lightbox.tsx`:

- the lightbox already owns face selection state via local `selectedFaceId`
- the lightbox resets selection whenever a new asset is opened
- there is no current `initialSelectedFaceId` prop
- the lightbox already reloads preview data after link/hide/block/manual-face writes
- candidate loading already follows current face state rules

### Existing preview/read-model boundary

Verified in `src/lib/matching/asset-preview-linking.ts`:

- preview face states are already canonical:
  - `linked_manual`
  - `linked_auto`
  - `unlinked`
  - `hidden`
  - `blocked`
- `currentLink.ownerState` is already `active` or `revoked`
- hidden wins over blocked, blocked wins over linked, linked/manual precedence is already preserved

### Existing canonical write boundary

Verified in `src/lib/matching/photo-face-linking.ts` and `src/lib/matching/project-face-assignees.ts`:

- one-owner-per-face semantics are already canonical
- manual, auto, hidden, blocked, and manual-face semantics are already live and must remain unchanged
- mixed one-off and recurring assignees already share the same exact-face ownership path
- reconcile already excludes hidden, blocked, and manual-created faces from auto ownership

## Options considered

### Option A: Extend `AssetsList` and reuse the current lightbox

Add derived review fields to the existing assets read model, add review filters/sort/badges/summary to `AssetsList`, and add small lightbox face-preselection support.

Pros:

- minimal surface-area change
- directly improves discovery and navigation
- preserves current review actions and semantics
- no new route or durable state

Cons:

- assets route must derive review status for filtered candidate assets
- lightbox needs a small new initialization prop

### Option B: Add a separate unresolved queue page

Pros:

- dedicated review surface

Cons:

- duplicates existing asset discovery and navigation concerns
- introduces a second review entry point
- exceeds the bounded scope of 060

### Option C: Add lightbox-only queue controls

Pros:

- smaller top-level UI change

Cons:

- does not solve discovery
- keeps the operator blind to which assets still need work

## Recommendation

Implement Option A.

Feature 060 will:

- stay inside the existing project assets surface
- keep the existing lightbox as the only resolution surface
- add additive asset-level review derivation server-side
- add small review UI affordances in `AssetsList`
- add minimal lightbox preselection support
- avoid schema changes and durable workflow tables

## Chosen architecture

### High-level shape

1. Extend the existing project assets read model with derived review fields.
2. Extend `GET /api/projects/[projectId]/assets` with review-aware filtering, sorting, and summary counts.
3. Update `AssetsList` to render:
   - review filter controls
   - one new review-first sort option
   - compact review summary
   - per-asset status badge and counts
4. Update `ProjectAssetPreviewLightbox` to accept an optional initial face id for selection on open.
5. Keep all actual review actions inside the existing lightbox.

### No schema changes

- no migration
- no new durable review-state table
- no change to exact-face ownership writes
- no change to reconcile, matching, queue, continuation, or export logic

## Exact unresolved and review definition

### Face-level unresolved rules

A face counts as unresolved when:

- `faceState === "unlinked"`

This includes:

- unlinked detector faces
- unlinked manual-created faces

### Face-level non-unresolved rules

A face does not count as unresolved when:

- `faceState === "hidden"`
- `faceState === "blocked"`
- face is linked

### Zero-face assets

- zero-face assets do not count as unresolved for Feature 060
- they fall into `resolved` unless future product work introduces a separate asset-quality queue

### Non-materialized assets

- photo assets without a current face materialization must derive as `pending`
- they must not be shown as `resolved` or done just because there are no current unlinked faces yet
- this keeps the project asset list honest while background face materialization is still outstanding

### Blocked treatment

- blocked is a distinct bucket
- blocked does not add to unresolved count
- blocked faces remain visible and actionable in the lightbox through the existing blocked-face flow

## Exact asset-level status model

### Derived fields

Per asset, derive:

- `reviewStatus`
- `unresolvedFaceCount`
- `blockedFaceCount`
- `firstNeedsReviewFaceId`

### Status derivation

Use this precedence:

1. `needs_review`
2. `blocked`
3. `pending`
4. `resolved`

Exact rules:

- `pending` when:
  - there is no current face materialization for the photo asset
- `needs_review` when:
  - there is a current face materialization
  - and `unresolvedFaceCount > 0`
- `blocked` when:
  - there is a current face materialization
  - `needs_review` is false
  - and `blockedFaceCount > 0`
- `resolved` otherwise

### First face to preselect

Derive `firstNeedsReviewFaceId` as:

1. first face with `faceState === "unlinked"` by `faceRank`
2. otherwise `null`

### Chosen `Blocked` filter semantics

For v1, `Blocked` is a strict status filter:

- it matches assets where `reviewStatus === "blocked"`

Reasoning:

- it keeps filter buckets mutually exclusive and easy to reason about
- it keeps summary counts additive and non-overlapping
- mixed assets with unresolved and blocked faces still appear in `Needs review`, which is the primary workflow for unfinished work
- blocked-face counts remain visible on `Needs review` assets, so blocked information is not lost

If users later need a broader "has blocked faces" filter, that can be added separately without changing the status model.

## Exact read-model and API plan

### Route changes

Extend `GET /api/projects/[projectId]/assets` with:

- new query param `review`
  - `all`
  - `needs_review`
  - `blocked`
  - `resolved`
- new sort option `needs_review_first`

### Response changes

Extend each asset row with:

- `reviewStatus: "pending" | "needs_review" | "blocked" | "resolved"`
- `unresolvedFaceCount: number`
- `blockedFaceCount: number`
- `firstNeedsReviewFaceId: string | null`

Extend the response payload with:

- `reviewSummary`
  - `totalAssetCount`
  - `needsReviewAssetCount`
  - `pendingAssetCount`
  - `blockedAssetCount`
  - `resolvedAssetCount`

### Summary count scope

Use current-query-scoped summary counts, defined as:

- after search query filtering
- after linked-person filtering
- before review-status filter
- before pagination

Reasoning:

- the counts stay relevant to the operator's current narrowed slice of the project
- filter chips can show stable counts while the user switches between review buckets
- this avoids mixing unrelated project-wide counts into a filtered search context

### Helper placement

Add the initial asset-level review derivation helper in `src/lib/matching/asset-preview-linking.ts`.

Recommended shape:

- a new exported helper that derives review summaries for a batch of asset ids
- the helper should stay adjacent to `getAssetPreviewFaces(...)` because it must stay aligned with the same face-state semantics

Implementation note:

- if the file becomes too large during implementation, extract the helper into a small adjacent module only after the shared derivation shape is clear
- do not create a separate review-specific domain model

### Derivation strategy

Inside the assets route:

1. Resolve tenant and project scope exactly as today.
2. Build the base candidate asset set from:
   - search query
   - linked-person filter
3. Load review summaries for the candidate asset ids in batches.
4. Compute `reviewSummary` counts from that candidate set.
5. Apply the selected review filter to the derived rows.
6. Apply the selected sort:
   - existing sorts as today
   - `needs_review_first` via in-memory derived-status ordering with `created_at_desc` tie-break
7. Apply pagination.
8. Hydrate only the page assets with the existing preview URL, overlay, and linked-people response fields.

### No client-trusted review state

- the client never computes authoritative review status
- the client only renders server-derived review fields
- the server remains the source of truth for all bucket membership and counts

## Exact UI and state plan

### `AssetsList` state additions

Add state for:

- `reviewFilter`, default `all`
- `sort` extended with `needs_review_first`
- `reviewSummary` from the assets API
- `pendingListRefreshOnClose`, used to defer list requery while the lightbox is open

Update the list query cache key to include:

- `reviewFilter`
- extended sort value

### Review controls

Add a compact review control strip above the asset grid:

- `All`
- `Needs review`
- `Blocked`
- `Resolved`

These should use the existing `projects.assetsList` i18n namespace for:

- filter labels
- status labels
- helper text
- empty states
- sort label

### Review summary strip

Include a compact v1 summary strip above the asset list.

Recommended contents:

- total scoped assets
- needs review asset count
- pending materialization asset count
- blocked asset count
- resolved asset count

This is small, informational, and directly supports discovery. It should not become a second workflow panel.

### Card/list item updates

Each asset card should gain:

- one status badge derived from `reviewStatus`
- one small needs-review count when greater than zero
- one small blocked count when greater than zero

Recommended card behavior:

- `pending` badge is explicit but low-emphasis
- `needs_review` badge is visually primary
- `blocked` badge is secondary/warning-toned
- `resolved` badge is low-emphasis

Do not replace existing linked-consent count or linked overlay behavior.

### Sort control

Add one new sort option:

- `Needs review first`

Recommended order for this sort:

1. `needs_review`
2. `blocked`
3. `pending`
4. `resolved`
5. then newest first

### Lightbox preselection

Add an optional prop to `ProjectAssetPreviewLightbox`:

- `initialSelectedFaceId?: string | null`

Apply it only when opening from review-focused context:

- when `reviewFilter === "needs_review"`

Do not preselect a face for:

- generic `All` view
- `Blocked` view
- `Resolved` view

Reasoning:

- the feature is primarily about unresolved work
- preselection in generic browsing would be surprising
- blocked assets are not unfinished by definition in this feature model

### Lightbox selection behavior

When the lightbox opens for a review-focused asset:

- initialize `selectedFaceId` from `initialSelectedFaceId`
- if the selected face disappears after a write, preserve current existing fallback behavior and clear invalid selection

Do not add:

- next unresolved face buttons
- queue-specific lightbox navigation

### Previous/next behavior after resolving the current asset

Chosen behavior for v1:

- keep lightbox navigation stable by deferring asset-list requery until the lightbox closes
- let the lightbox refresh its own preview data after writes, as it already does
- replace immediate parent-list page refresh with a deferred "refresh on close" flag

Reasoning:

- this preserves the current previous/next asset order for the operator's active review session
- it avoids index drift when the current asset would otherwise drop out of the filtered result set mid-session
- it is the smallest stable solution

Resulting user behavior:

- while the lightbox is open, the operator can continue navigating the current filtered snapshot
- once the lightbox closes, `AssetsList` refetches the active query and the resolved asset naturally disappears from `Needs review`

## Security and reliability considerations

- All review derivation remains server-side and tenant-scoped.
- Tenant id is still derived from authenticated membership, never accepted from the client.
- The assets route remains the source of truth for review filter membership and counts.
- No change is made to canonical write paths or exact-face ownership semantics.
- No new client-side rule decides hidden, blocked, unlinked, or pending-vs-resolved semantics.
- No schema migration is introduced for this feature.
- Deferred list refresh on lightbox close avoids unstable mid-session pagination and navigation.
- Shared tests must guard against drift between preview-face semantics and asset-level review derivation.
- Existing retries/idempotency on writes remain unchanged because 060 is read-model and UI focused.

## Edge cases

### Only blocked faces

- asset derives as `blocked`
- unresolved count stays `0`
- asset appears only in `Blocked` or `All`

### One resolved owner plus one unresolved face

- asset derives as `needs_review`
- unresolved count is positive
- opening from `Needs review` preselects the unresolved face

### Manual-created faces needing assignment

- unlinked manual-created faces contribute to `unresolvedFaceCount`
- manual-created linked active faces are resolved

### All faces hidden

- asset derives as `resolved`
- hidden faces do not contribute to unresolved or blocked counts

### Non-materialized assets

- assets without a current face materialization derive as `pending`
- they do not count as `resolved`
- they stay visible in `All` and in summary counts until materialization completes

### Mixed recurring and one-off owners

- owner kind does not affect review derivation
- only face state and materialization presence matter

### Zero-face assets

- remain `resolved`
- do not enter the unresolved queue

### Lightbox open while list data becomes stale

- the lightbox remains authoritative for the current asset because it refetches preview data after writes
- the asset list is intentionally refreshed only on close

## Test plan

### Most relevant existing files to extend

- `tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`
  - extend for unresolved-vs-hidden derivation
  - confirm hidden faces do not affect unresolved counts
- `tests/feature-047-manual-face-box-creation-in-asset-preview.test.ts`
  - extend for manual-created unlinked faces counting as unresolved
  - confirm zero-detector assets with no manual face remain resolved
- `tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`
  - extend for blocked being separate from unresolved
  - confirm blocked-only assets derive as `blocked`
- `tests/feature-044-asset-preview-linking-ux-improvements.test.ts`
  - extend component-level lightbox behavior for `initialSelectedFaceId`

### New focused test coverage to add

Add a new focused test file for Feature 060 route/UI behavior:

- `tests/feature-060-project-unresolved-face-review-queue.test.ts`

This file should cover:

- asset-level review summary derivation for mixed asset states
- review filter behavior in the assets route
- `needs_review_first` sorting
- strict `Blocked` filter semantics
- `reviewSummary` count semantics
- `firstNeedsReviewFaceId` derivation
- deferred asset-list refresh behavior while the lightbox is open

### Minimum assertions to include

- `unlinked` faces count toward unresolved
- hidden faces do not count toward unresolved
- blocked faces do not count toward unresolved
- non-materialized assets derive as `pending`
- blocked-only assets derive as `blocked`
- assets with both resolved and unresolved faces derive as `needs_review`
- assets with all active linked faces derive as `resolved`
- opening from `Needs review` passes/uses `initialSelectedFaceId`
- closing the lightbox after a resolving write triggers list refresh and removes the asset from the `Needs review` list

## Implementation phases

### Phase 1: Server read-model derivation

- extend assets route query parsing with `review` and `needs_review_first`
- add batched asset review derivation helper next to preview helpers
- return per-asset review fields and `reviewSummary`
- keep existing URL signing and overlay hydration behavior

### Phase 2: Asset list filters, sort, badges, and summary

- extend `AssetsList` types with review fields
- add review filter controls
- add summary strip
- add `Needs review first` sort option
- add asset status badge and counts
- add i18n keys for all new labels and helper text

### Phase 3: Lightbox preselection and stable navigation polish

- add `initialSelectedFaceId` prop to the lightbox
- initialize selection when opening from `Needs review`
- switch parent list refresh to deferred-on-close behavior
- refetch active query on close when deferred refresh is pending

### Phase 4: Tests and i18n completion

- extend existing domain tests
- add focused Feature 060 route/UI tests
- add English and Dutch message keys for the new asset-review UI copy
- run lint/tests during implementation

## Scope boundaries

### Included

- asset-level derived review fields
- project assets review filters
- review-first sort
- compact review summary
- status badges and counts on asset cards
- unresolved-face preselection when entering from `Needs review`
- stable previous/next navigation during an open review session

### Explicitly not included

- separate unresolved queue page
- second face-review UI
- human validation workflow for all auto links
- reviewer approval or publish readiness state
- batch assign/hide/block actions
- export redesign
- matching pipeline redesign
- recurring consent workflow redesign
- new durable review-state tables
- dedicated next-unresolved-face navigation inside the lightbox

## Concise implementation prompt

Implement Feature 060 inside the existing project assets surface. Extend `GET /api/projects/[projectId]/assets` to derive and return `reviewStatus`, `unresolvedFaceCount`, `blockedFaceCount`, `firstNeedsReviewFaceId`, and a current-query-scoped `reviewSummary`. Non-materialized photo assets must derive as `pending`, not `resolved`. Add `review=all|needs_review|blocked|resolved` and `sort=needs_review_first`. In `AssetsList`, add review filters, a compact review summary strip that also reports pending materialization items, a `Needs review first` sort option, and per-asset status badges/counts using existing `projects.assetsList` i18n conventions. Keep blocked distinct from unresolved, do not mark non-materialized assets as done, and do not add new workflow tables. Add `initialSelectedFaceId` to `ProjectAssetPreviewLightbox` and use it only when opening from `Needs review`. Preserve stable previous/next navigation by deferring asset-list refetch until lightbox close while still letting the lightbox refresh its own preview data after writes. Extend the focused Feature 060 tests for pending-materialization behavior alongside route/filter/sort/preselection behavior.
