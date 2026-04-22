# Feature 060 Research: Project Unresolved Face Review Queue

## Goal

Define the smallest coherent next step after Features 049-059 that helps operators find unfinished face-review work at the project level, prioritize it, and jump directly into the existing project asset preview lightbox to resolve it.

This research is grounded in live code and schema. Prior RPI docs were used as context and architecture history only. Where older docs and the current repository differ, the live code was treated as the source of truth.

## Inputs reviewed

### Core repo docs

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`

### Most relevant prior RPI docs

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
- `docs/rpi/057-project-matching-integration-for-ready-recurring-profiles/research.md`
- `docs/rpi/057-project-matching-integration-for-ready-recurring-profiles/plan.md`
- `docs/rpi/058-project-local-assignee-bridge-for-profile-backed-matches/research.md`
- `docs/rpi/058-project-local-assignee-bridge-for-profile-backed-matches/plan.md`
- `docs/rpi/059-auto-assignment-for-project-scoped-recurring-assignees/research.md`
- `docs/rpi/059-auto-assignment-for-project-scoped-recurring-assignees/plan.md`

### Live schema, code, and tests verified

- Current project page and assets surface:
  - `src/app/(protected)/projects/[projectId]/page.tsx`
  - `src/components/projects/assets-list.tsx`
  - `src/components/projects/project-asset-preview-lightbox.tsx`
  - `src/components/projects/previewable-image.tsx`
  - `src/app/api/projects/[projectId]/assets/route.ts`
- Preview, face state, and candidate read models:
  - `src/lib/matching/asset-preview-linking.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
- Exact-face ownership and face-state logic:
  - `src/lib/matching/photo-face-linking.ts`
  - `src/lib/matching/project-face-assignees.ts`
  - `src/lib/matching/manual-asset-faces.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/manual-faces/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]/route.ts`
- Downstream/export seam:
  - `src/lib/project-export/project-export.ts`
- Boundary tests:
  - `tests/feature-044-asset-preview-linking-ux-improvements.test.ts`
  - `tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`
  - `tests/feature-047-manual-face-box-creation-in-asset-preview.test.ts`
  - `tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`
  - `tests/feature-058-project-local-assignee-bridge.test.ts`

### Requested input not present in the live repo

- `tests/feature-059-auto-assignment-for-project-scoped-recurring-assignees.test.ts`

Feature 059 behavior is present in live code, but the requested dedicated test file does not exist in the repository snapshot reviewed for this research.

## Verified current project asset and preview boundary

### 1. The current project assets surface is the existing review entry point

Verified in `src/app/(protected)/projects/[projectId]/page.tsx`:

- the project page renders `AssetsList` inside the main project detail page
- there is no separate unresolved-review route or queue page
- there is no top-level project summary for unresolved or blocked faces

Verified in `src/components/projects/assets-list.tsx`:

- the current asset surface already supports search, pagination, and sorting
- current sort options are limited to:
  - `created_at_desc`
  - `created_at_asc`
  - `file_size_desc`
  - `file_size_asc`
- current filtering is by linked consent ids only
- each asset card/list item already shows preview image, metadata, linked consent count, and linked face overlays
- selecting an asset opens `ProjectAssetPreviewLightbox`
- the lightbox already receives `onPrevious` and `onNext` callbacks based on the current filtered asset list

There is no current asset-level review status, unresolved count, blocked count, or review-oriented sorting/filtering.

### 2. The lightbox already contains the actual face review tools

Verified in `src/components/projects/project-asset-preview-lightbox.tsx` and the preview routes:

- the lightbox fetches `preview-faces` for the selected asset
- it can render all current face overlays
- it supports zoom, pan, drag, and face selection
- it shows linked-owner strip and detail side panel
- it can fetch per-face preview candidates
- it supports manual linking and changing the owner
- it supports hide, restore, block, and clear-block actions
- it supports manual face-box creation
- it already has previous/next asset navigation within the current asset list context

This is already the main review surface. Feature 060 does not need a second face-review UI.

### 3. The preview read model already exposes the face states needed for review derivation

Verified in `src/lib/matching/asset-preview-linking.ts`:

- each preview face has:
  - `faceSource`
  - `faceState`
  - `hiddenAt`
  - `blockedAt`
  - `blockedReason`
  - `currentLink`
- current face states are:
  - `linked_manual`
  - `linked_auto`
  - `unlinked`
  - `hidden`
  - `blocked`
- `currentLink.ownerState` is currently meaningful and can be:
  - `active`
  - `revoked`

The live derivation already preserves exact-face semantics:

- hidden beats blocked
- blocked beats linked
- linked remains exactly one current owner per face
- manual-created faces participate in preview as first-class faces
- hidden, blocked, and manual-face behavior are not alternative review systems; they are part of the canonical face state

Verified in `src/lib/matching/photo-face-linking.ts`, the current reconcile path also already preserves the post-058/059 ownership boundary:

- hidden, blocked, and manual-created faces are excluded from auto reconcile
- mixed one-off and recurring assignees already participate in the same canonical exact-face ownership model
- assignee-level suppressions already exist and are respected during reconcile

Feature 060 should not alter any of that logic. It should only derive review-oriented read fields from the existing canonical state.

### 4. The current assets API does not derive review status

Verified in `src/app/api/projects/[projectId]/assets/route.ts`:

- the asset list response includes:
  - asset file metadata
  - signed thumbnail and preview URLs
  - `linkedConsentCount`
  - `linkedPeople`
  - `linkedFaceOverlays`
- it does not include:
  - unresolved face count
  - blocked face count
  - derived asset review status
  - preselected face id for review navigation

### 5. There is no current project-level unresolved summary

Neither the project page nor the asset list currently exposes:

- project-level unresolved totals
- a needs-review filter
- a blocked filter
- resolved vs unresolved asset counts
- a review queue concept

Today the operator must discover unfinished work by opening assets one at a time.

## Current schema, routes, components, and helpers involved

### UI surfaces

- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/assets-list.tsx`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`

### Read-model and exact-state helpers

- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/project-face-assignees.ts`
- `src/lib/matching/manual-asset-faces.ts`

### Current routes that already power review actions

- `GET /api/projects/[projectId]/assets`
- `GET /api/projects/[projectId]/assets/[assetId]/preview-faces`
- `GET /api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates`
- `POST /api/projects/[projectId]/assets/[assetId]/manual-faces`
- `PUT/DELETE /api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]`
- `PUT/DELETE /api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]`
- current face assignment route used by the lightbox

### Downstream seam to preserve

- `src/lib/project-export/project-export.ts`

Verified in the current export seam, project export metadata includes detected faces and linked owners, but does not expose unresolved, blocked, or review-status fields. Feature 060 should stay additive to the project asset read model and should not introduce a new durable review workflow table unless derivation proves insufficient. Current live code does not indicate that such a table is necessary.

## Options considered

### Option A: Extend the existing project assets surface

Add review-oriented derived fields and small UI affordances to `AssetsList`, then open the existing lightbox as the place where actual resolution happens.

Possible additions:

- asset-level derived status badge
- unresolved and blocked counts
- project-level summary counts above the asset list
- review filters and review-first sorting
- optional preselection of the first unresolved face when opening from a review-focused context

Pros:

- reuses the current entry surface and lightbox
- minimal architectural change
- preserves existing review semantics and actions
- lets existing previous/next asset navigation act as queue navigation inside a filtered list

Cons:

- requires extending the asset list read model
- requires a small amount of lightbox selection plumbing if face preselection is added

### Option B: Add a separate unresolved queue page

Create a dedicated project-level review page that lists unresolved faces/assets and launches the existing lightbox.

Pros:

- can be highly focused on review work

Cons:

- duplicates project asset discovery and navigation concerns
- risks creating a second review entry path with its own filtering, paging, and status semantics
- adds more UI and routing surface than needed for the current problem

### Option C: Add a queue inside the lightbox only

Keep the asset list unchanged and add unresolved navigation controls only after an asset is opened.

Pros:

- smaller visible UI change on the asset list

Cons:

- does not solve the primary discovery problem
- forces the operator to find the first unresolved asset manually

## Recommendation

Recommend Option A, with one small lightbox enhancement:

- extend the existing project assets surface with derived review status, counts, filters, and review-first sorting
- keep the existing lightbox as the only face-resolution surface
- optionally preselect the first unresolved face when the asset is opened from a review-focused filter or action
- rely on existing previous/next asset navigation within the filtered asset list instead of adding a separate queue page

This is the smallest coherent workflow that improves discovery, filtering, prioritization, and navigation without inventing a second review system.

## Recommended definition of unresolved or unfinished

Feature 060 should stay operational and small. "Needs review" should mean that the operator still has an actionable face-level decision to make or repair inside the current lightbox.

### Current unresolved conditions

Count a face as unresolved when:

- its current preview `faceState` is `unlinked`

This covers:

- detector-created faces with no owner
- manual-created faces with no owner

### Current non-unresolved conditions

Do not count a face as unresolved when:

- it is `hidden`
- it is `blocked`
- it is linked

Reasoning:

- hidden is an intentional suppression choice and should not keep an asset in a review queue
- blocked is also an operator decision, but it remains operationally useful to surface separately
- active linked faces are already resolved for the purpose of this feature

### Recommended treatment of blocked

Blocked should be a separate review bucket, not part of unresolved count.

Reasoning:

- blocked faces are still important to find
- but they are usually already dispositioned rather than awaiting an owner decision
- mixing blocked into unresolved would make "needs review" noisy and harder to trust

### Zero-face assets

Assets with zero visible or detected faces should not be marked unresolved by Feature 060 alone. They can remain neutral/resolved from this feature's perspective unless the product later introduces a separate asset-quality review workflow.

### Non-materialized assets

Assets without a current face materialization should not be marked `resolved` just because there are no current unlinked faces yet.

Instead, the live implementation keeps them in a separate `pending` review state until a current materialization exists.

## Implemented asset-level statuses and filters

### Current derived asset statuses

The live implementation uses this status taxonomy:

- `pending`
- `needs_review`
- `blocked`
- `resolved`

Current derivation:

- `pending` when:
  - the photo asset does not yet have a current face materialization for the active materializer version
- `needs_review` when:
  - a current materialization exists
  - and `unresolvedFaceCount > 0`
- `blocked` when:
  - a current materialization exists
  - not `needs_review`
  - and `blockedFaceCount > 0`
- `resolved` otherwise

This keeps newly uploaded photos out of the done/resolved bucket until face materialization has actually completed.

### Current asset-level counts

The live implementation currently exposes:

- `unresolvedFaceCount`
- `blockedFaceCount`

The current implementation does not expose a separate revoked-owner review subcount.

### Current filters

The asset list currently exposes these filters:

- `All`
- `Needs review`
- `Blocked`
- `Resolved`

Current semantics:

- `All`: no review-state restriction
- `Needs review`: assets where `reviewStatus = needs_review`
- `Blocked`: assets where `reviewStatus = blocked`
- `Resolved`: assets where `reviewStatus = resolved`

Pending assets currently remain visible through `All` and the review summary strip, but they do not have a dedicated filter tab.

### Current sorting

The current implementation keeps the existing sort options and adds:

- `Needs review first`

Current order:

1. `needs_review`
2. `blocked`
3. `pending`
4. `resolved`
5. tie-break by current default `created_at_desc`

## Recommended fit with the current project assets surface

Feature 060 should stay inside the current project assets surface, not a new route.

Recommended additions to the assets area:

- a compact review summary strip above the asset list
- review filter chips or tabs
- one additional review-first sort option
- status badge and small counts on each asset card/list item

Current summary values:

- assets needing review
- assets pending materialization
- assets with blocked faces
- resolved assets

This summary should remain informational and navigational. It should not become a second workflow panel with its own actions.

## Recommended lightbox navigation behavior

### Recommended for Feature 060

- support opening an asset with a preselected first review-relevant face
- keep using the existing previous/next asset navigation
- when the user is in a review-focused filter, previous/next should naturally move through the filtered review set

### Recommended preselection rule

When opening from a review-focused context, preselect:

1. the first `unlinked` face by face rank
2. otherwise no special selection

This is the smallest lightbox enhancement that reduces operator clicks without redesigning navigation.

### Explicitly not recommended yet

Do not add in Feature 060:

- dedicated "next unresolved face" controls inside the lightbox
- a second queue UI inside the lightbox
- a global review cursor stored server-side

The existing asset-to-asset navigation is already present and becomes much more useful once the list itself can be filtered and sorted for review work.

## Should auto-linked high-confidence assets be part of 060?

No. Feature 060 should focus on unresolved or unfinished work only.

Do not include a general human-validation workflow for already auto-linked active faces in this feature.

Reasoning:

- current live semantics treat active auto links as current resolved ownership, not pending review
- adding a human-validation layer would require new product semantics and likely new durable state
- that would substantially expand scope beyond discovery and navigation

If the product later wants "review all auto links" or "approve before publish," that should be a separate feature with its own status model.

## Required read-model changes

### Recommended server-derived fields for the assets list

Add derived review fields to the existing project assets list response:

- `reviewStatus`
- `unresolvedFaceCount`
- `blockedFaceCount`
- `firstNeedsReviewFaceId` or equivalent

These should be derived server-side from the current exact-face state and preview semantics, not trusted from the client.

### Likely helper boundary

The cleanest shape is a shared server helper that can derive review summaries for a batch of asset ids using the same canonical tables that already feed preview state.

The plan phase should decide whether to:

- extend an existing helper in `src/lib/matching/asset-preview-linking.ts`
- or add a small adjacent helper focused on asset-level review summaries

The important point is to derive from current canonical face state, not duplicate review logic in the client.

### Lightbox input change

If face preselection is included, add a small prop such as:

- `initialSelectedFaceId?: string | null`

Then initialize or refresh lightbox local selection when opening a review-focused asset.

That is sufficient for Feature 060. No durable queue state is needed.

## Security and reliability considerations

- Keep all review-status derivation server-side.
- Preserve tenant scoping in every query by deriving tenant membership from the authenticated session.
- Never accept tenant id or derived review status from the client.
- Preserve current exact-face ownership semantics and one-owner-per-face behavior.
- Do not introduce client-side decisions about hidden, blocked, or pending-vs-resolved semantics.
- Keep writes idempotent and unchanged where possible; Feature 060 is primarily a read-model and navigation improvement.
- Avoid introducing new durable review tables unless derivation proves insufficient.
- Ensure filtered navigation remains stable when asset data refreshes after a write inside the lightbox.

## Edge cases

### Assets with only blocked faces

- should not appear in `needs_review`
- should appear in the blocked bucket/filter
- should remain directly reviewable in the current lightbox

### Assets with one resolved owner and one unresolved face

- should be `needs_review`
- should show a positive unresolved count
- opening from review mode should preselect the unresolved face

### Assets with manual-created faces needing assignment

- manual-created unlinked faces should count as unresolved
- this keeps manual face-box workflows integrated into the same queue

### Assets where all faces are hidden

- should not be `needs_review`
- should usually appear as `resolved` for Feature 060 purposes
- hidden faces should remain available only through the existing hidden-face affordance in the lightbox

### Non-materialized assets

- assets without a current face materialization should derive as `pending`
- they should not be treated as `resolved`
- they remain visible in `All` and in the summary strip until materialization finishes

### Mixed recurring and one-off owners

- unresolved derivation should ignore owner kind and rely on current face state plus owner activity
- this preserves the 058/059 mixed-owner behavior without adding separate review rules by owner type

### Assets with zero faces

- should not be pulled into unresolved review by default
- this remains outside the current feature scope

### Filtered navigation after a write

- if resolving a face changes an asset from `needs_review` to `resolved`, the client must handle the current filtered list coherently
- the plan phase should decide whether the current asset remains open until close, or whether the surrounding list refresh can move it out of the filtered set only after close

## Explicitly deferred work

- a separate unresolved queue page
- a second face-review UI replacing the lightbox
- human validation status for all auto-linked faces
- reviewer approval workflow
- publish readiness or export approval workflow
- batch hide, block, assign, or other bulk actions
- export redesign
- recurring consent workflow redesign
- source enumeration redesign
- one-off/profile merge work
- durable review-state tables
- face-level SLA, aging, or assignment-owner dashboarding
- dedicated "next unresolved face" controls inside the lightbox

## Open decisions for the plan phase

- Should the `Blocked` filter mean:
  - strict `reviewStatus = blocked`
  - or broader `blockedFaceCount > 0`
- Should the review summary counts reflect:
  - the full project
  - or only the current query/filter result set
- Should opening an asset from the generic `All` view also preselect the first unresolved face when one exists, or only do that from explicit review-focused actions
- Where should the batch asset-review derivation helper live so it stays aligned with preview-face semantics without overloading the preview payload path
- What test additions should anchor:
  - asset-level review-status derivation
  - blocked vs unresolved status bucketing
  - lightbox face preselection
  - filtered previous/next asset navigation after resolving the current asset

## Recommended smallest usable 060 slice

The smallest production-worthy slice is:

1. Derive asset-level review fields on the server, including `pending` for non-materialized photos.
2. Add `Needs review`, `Blocked`, and `Resolved` filters to the existing assets surface.
3. Add status badge and small review counts to asset cards/list items without showing non-materialized photos as done.
4. Add a `Needs review first` sort option with `pending` ahead of `resolved`.
5. Open the existing lightbox and preselect the first unresolved face when entering from a review-focused context.

This is enough to make unfinished work discoverable and navigable without changing the underlying review model.
