# Feature 061 Plan: Link Consent to Whole Asset

## Inputs and ground truth

### Required docs re-read

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/061-link-consent-to-whole-asset/research.md`

### Targeted live verification completed

- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/project-face-assignees.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment/route.ts`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/lib/matching/asset-preview-linking.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
- `src/lib/matching/manual-asset-faces.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/manual-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]/route.ts`
- `src/lib/project-export/project-export.ts`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260415210000_058_project_face_assignee_bridge.sql`
- `supabase/migrations/20260416090000_059_generic_face_assignee_suppressions.sql`
- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
- `tests/feature-044-asset-preview-linking-ux-improvements.test.ts`
- `tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`
- `tests/feature-047-manual-face-box-creation-in-asset-preview.test.ts`
- `tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`
- `tests/feature-058-project-local-assignee-bridge.test.ts`

### Planning constraints carried forward from research

- exact-face ownership remains the canonical face-specific model
- whole-asset links are manual-only in 061
- whole-asset links must support both one-off and recurring assignees
- whole-asset links must not participate in face exclusivity or auto-match logic
- hidden, blocked, and manual-face behavior must stay exact-face-specific
- current preview/lightbox remains the main review surface
- export widening must stay minimal

## Verified current planning boundary

### Exact-face ownership is already project-assignee-based

Live code confirms:

- `asset_face_consent_links` already carries `project_face_assignee_id`
- `project_face_assignees` already represents both:
  - `project_consent`
  - `project_recurring_consent`
- `manualLinkPhotoToProjectFaceAssignee(...)` already centralizes:
  - manual replace conflict handling
  - move-existing-face behavior
  - block-clear-on-manual-save behavior
  - consent fallback cleanup for same consent

This means 061 should reuse project-face assignees directly rather than invent another identity bridge.

### Current asset-level fallback is still consent-only and zero-face-only

Live code still uses:

- `asset_consent_manual_photo_fallbacks`
- `asset_consent_manual_photo_fallback_suppressions`

Current `manualLinkPhotoToConsent(...)` and `manualUnlinkPhotoFromConsent(...)` still branch on `mode: "asset_fallback"` and still reject that mode when detected faces exist.

### Preview is still exact-face-only

Live preview behavior remains:

- `getAssetPreviewFaces(...)` returns face rows only
- `getAssetPreviewFaceCandidates(...)` is face-scoped only
- `ProjectAssetPreviewLightbox` shows exact linked faces via the linked-people strip
- `Link to entire asset` is still rendered as a disabled menu item

### Export is already split between exact-face assignee links and consent-only fallback rows

Current export reads:

- exact-face links from `asset_face_consent_links`
- fallback rows from `asset_consent_manual_photo_fallbacks`

Current JSON still emits `linkMode: "asset_fallback"` for fallback rows and synthesizes a fake fallback assignee id like `fallback:${consentId}`.

### Hidden, blocked, and manual-face seams are already stable

Live behavior to preserve:

- blocked faces remain visible but have no `currentLink`
- hidden faces are excluded until restored
- manual exact linking clears block first
- hiding a blocked face is rejected
- blocking a hidden face is rejected
- manual face boxes remain exact-face refinements, not asset-level ownership

## Recommendation

Implement 061 as an additive manual-only whole-asset ownership feature backed by one new generic asset-level assignee table.

Concrete decisions:

- add a new canonical whole-asset current-state table keyed by `asset_id + project_face_assignee_id`
- support both one-off and recurring assignees through the existing `project_face_assignees` model
- keep exact-face ownership stronger than whole-asset ownership
- choose eager delete, not read-time shadowing, when same-assignee exact-face ownership appears
- add new asset-centric write routes for whole-asset create/delete
- widen preview/lightbox reads to include whole-asset linked owners
- add a separate asset-level candidate picker route
- backfill old zero-face fallback rows into the new table and stop using the old fallback tables in steady-state 061 logic
- keep the old consent-side `asset_fallback` route contract only as a compatibility wrapper for one cycle

This is the smallest coherent model that matches 058 and 059 instead of fighting them.

## Chosen semantic model

### Definition

A whole-asset link means:

- a specific project-scoped assignee is intentionally linked to the asset as a whole
- the link is a manual current-state operator decision
- the link is not tied to any exact face
- the link may coexist with exact-face links for other assignees on the same asset

It does not mean:

- an exact-face owner
- a replacement for face review
- a signal that blocked or unresolved exact faces are acceptable
- an auto-match result

### Strength relative to exact-face links

Exact-face ownership is stronger and more specific than whole-asset ownership.

Rules:

- exact-face ownership always wins for the same assignee on the same asset
- whole-asset links never affect one-owner-per-face enforcement
- whole-asset links never affect exact-face suppression logic

### Coexistence rules

- multiple whole-asset links on one asset are allowed
- whole-asset links and exact-face links may coexist on the same asset
- the same assignee cannot simultaneously appear as both:
  - a whole-asset link owner
  - an exact-face owner
  on the same asset in steady-state current data

## Exact schema/model plan

### New table

Add `public.asset_assignee_links`.

Chosen meaning:

- current manual whole-asset ownership rows only

Chosen columns:

- `asset_id uuid not null`
- `project_face_assignee_id uuid not null`
- `tenant_id uuid not null references public.tenants(id) on delete restrict`
- `project_id uuid not null`
- `link_source text not null default 'manual'`
- `created_at timestamptz not null default now()`
- `created_by uuid null references auth.users(id) on delete set null`
- `updated_at timestamptz not null default now()`

Chosen constraints:

- primary key on `(asset_id, project_face_assignee_id)`
- FK `(asset_id, tenant_id, project_id)` -> `assets`
- FK `(project_face_assignee_id, tenant_id)` -> `project_face_assignees`
- check `link_source in ('manual')`

Chosen indexes:

- index on `(tenant_id, project_id, asset_id)`
- index on `(tenant_id, project_id, project_face_assignee_id)`
- optional index on `(tenant_id, project_id, created_at desc)` for recent reads if needed

### Why this shape

- it matches the current exact-face assignee identity model
- it keeps whole-asset linking distinct from exact-face ownership
- it is future-compatible with video-wide linking because it is asset-scoped
- it avoids introducing another consent-only fallback table

### RLS and grants

Mirror the exact-face and project-assignee tables:

- enable RLS
- revoke default public/anon access
- grant authenticated and service role access
- use the same project membership policy pattern as current project-scoped matching tables

### Migration and backfill

061 should backfill existing zero-face fallback rows into the new table:

1. Ensure consent-backed `project_face_assignees` exist for any fallback `consent_id`.
2. Insert `asset_assignee_links` rows by resolving the matching consent-backed assignee id.
3. Use `link_source = 'manual'`, `created_by`, `created_at`, and `updated_at` from the fallback row where possible.

Keep the old fallback tables physically in place for one cycle, but stop using them in steady-state 061 writes and main reads.

## Exact interaction with exact-face ownership

### Chosen strategy: eager delete

Choose eager delete, not read-time shadowing.

Reason:

- simpler preview reads
- simpler export reads
- simpler consent-side linked-photo reads
- no duplicate same-assignee owner rows to filter everywhere

### Rule 1: whole-asset create when same assignee already has an exact-face link

Do not create the whole-asset row.

Return a conflict result, for example:

- `409 asset_assignee_exact_face_exists`

Include metadata:

- `assetFaceId`
- `faceRank`
- `linkSource`

This keeps exact-face ownership authoritative and avoids duplicate current-state rows.

### Rule 2: exact-face create when same assignee already has a whole-asset link

Delete the same-assignee whole-asset row eagerly before completing the exact-face save.

This must apply to:

- manual one-off exact-face linking
- manual recurring exact-face linking
- exact-face auto reconciliation for consent-backed assignees

### Rule 3: existing exact-face helper integration

Integrate eager delete into the exact-face path by adding a small helper such as:

- `deleteWholeAssetLinkForAssignee(...)`

Call it from:

- `manualLinkPhotoToProjectFaceAssignee(...)`
- exact-face auto reconcile write path before or after exact-face upsert convergence

This keeps the current exact-face helper architecture intact.

## Exact write plan

### New asset-centric whole-asset routes

Add:

- `POST /api/projects/[projectId]/assets/[assetId]/whole-asset-links`
- `DELETE /api/projects/[projectId]/assets/[assetId]/whole-asset-links`

Chosen request body shape:

```ts
type WholeAssetLinkBody = {
  identityKind?: "project_consent" | "recurring_profile_match";
  consentId?: string;
  projectProfileParticipantId?: string;
};
```

This matches the existing face-assignment route contract style and keeps server-side assignee resolution authoritative.

### New server helpers

Add focused helpers in the matching layer, reusing existing assignee resolution:

- `manualLinkWholeAssetToConsent(...)`
- `manualLinkWholeAssetToRecurringProjectParticipant(...)`
- `manualLinkWholeAssetToProjectFaceAssignee(...)`
- `manualUnlinkWholeAssetAssignment(...)`
- `loadCurrentWholeAssetLinksForAsset(...)`
- `loadCurrentWholeAssetLinksForAssets(...)`

These should reuse:

- `ensureProjectConsentFaceAssignee(...)`
- `ensureProjectRecurringConsentFaceAssignee(...)`
- `loadProjectFaceAssigneeDisplayMap(...)`

### Write behavior

Create:

- resolve tenant/project/asset server-side
- resolve or ensure `project_face_assignee_id`
- reject revoked one-off consent
- reject recurring participant without signed active project recurring consent
- reject if same assignee already exact-face-linked on the asset
- upsert into `asset_assignee_links` on `(asset_id, project_face_assignee_id)`

Delete:

- resolve the assignee from the same request contract
- delete the exact row if present
- return success even if no row existed

### Idempotency

Required behavior:

- repeated create for the same asset and assignee returns success and converges to one row
- repeated delete returns success and converges to no row

## Compatibility plan for old zero-face fallback

### Chosen approach

Keep a temporary compatibility layer, but move canonical storage now.

That means:

- canonical current whole-asset state lives only in `asset_assignee_links`
- old zero-face fallback tables are backfilled once, then retired from steady-state logic
- old consent-side route contracts remain available for one cycle as compatibility wrappers

### Compatibility behavior by surface

#### Consent-side `assets/links` route

Keep `mode: "asset_fallback"` in the route contract for one cycle.

Implementation behavior after 061:

- `POST/DELETE /consents/[consentId]/assets/links` with `mode: "asset_fallback"` delegates to the new generic whole-asset helper for the consent-backed assignee
- preserve the old zero-face-only validation in this legacy route path so the older consent-centric dialog behavior stays unchanged in 061

This keeps 061 bounded to the preview/lightbox while avoiding a second canonical model.

#### `getManualPhotoLinkState(...)`

Keep the old read contract for the consent-centric dialog:

- `fallbackAllowed` remains zero-face-only
- `currentConsentLink.mode = "asset_fallback"` remains as the legacy mode name there

Internally, it should read from `asset_assignee_links` for the consent-backed assignee instead of the old fallback table.

#### `listLinkedPhotosForConsent(...)`

Widen this function to read:

- exact-face links from `asset_face_consent_links`
- whole-asset consent-backed links from `asset_assignee_links`

Chosen return behavior:

- emit `link_mode: "whole_asset"` for the new generic rows
- continue accepting old `asset_fallback` only as an internal legacy alias during migration cleanup

This ensures consent-backed whole-asset links created in preview are visible in consent-side linked-photo views.

### What happens to the old tables after 061

- keep them physically in the schema for one cycle
- do not write new steady-state rows to them
- optionally leave a follow-up cleanup migration for a later cycle once all compatibility reads are removed

## Preview/lightbox plan

### Read-model plan

Widen `getAssetPreviewFaces(...)` to return a second linked-owner collection:

```ts
type AssetPreviewWholeAssetLink = {
  projectFaceAssigneeId: string;
  identityKind: "project_consent" | "project_recurring_consent";
  consentId: string | null;
  projectProfileParticipantId: string | null;
  profileId: string | null;
  recurringProfileConsentId: string | null;
  linkSource: "manual";
  displayName: string | null;
  email: string | null;
  ownerState: "active" | "revoked";
  createdAt: string;
  consent: {...} | null;
  recurring: {...} | null;
};
```

Add to the preview response:

- `wholeAssetLinks: AssetPreviewWholeAssetLink[]`

Face rows remain unchanged.

### New asset-level candidate route

Add:

- `GET /api/projects/[projectId]/assets/[assetId]/whole-asset-candidates`

Purpose:

- load asset-level add-person candidates for the `Link to entire asset` action

Chosen candidate sources:

- consent-backed project assignees derived from current project consents
- recurring candidates derived from current project participants and recurring consent state

Chosen candidate fields:

- `candidateKey`
- `identityKind`
- `consentId`
- `projectProfileParticipantId`
- `assignable`
- `assignmentBlockedReason` for recurring rows
- `fullName`
- `email`
- `headshotThumbnailUrl`
- `currentWholeAssetLink`
- `currentExactFaceLink`

`currentExactFaceLink` is needed so the UI can show why same-assignee create is blocked and why exact-face ownership is stronger.

### Preview UI changes

Keep the existing exact-face linked-people strip intact.

Add:

- one new strip for current whole-asset owners
- one picker tray for creating a whole-asset link
- one detail tray for an existing whole-asset owner with unlink action

Recommended component additions:

- `AssetPreviewWholeAssetPeopleStrip`
- `AssetPreviewWholeAssetPickerTray`
- `AssetPreviewWholeAssetLinkTray`

### Current add-person menu behavior after 061

Change the existing menu to:

- `Select face` -> unchanged draw/select flow
- `Link to entire asset` -> open the whole-asset picker tray

The current disabled placeholder becomes a real action.

### Selection and refresh behavior

- whole-asset picker does not require a selected face
- saving a whole-asset link refreshes `preview-faces`
- unlinking a whole-asset link refreshes `preview-faces`
- current exact-face selection state should remain intact unless the UI explicitly enters whole-asset owner detail mode

### i18n

Add new translation keys for:

- whole-asset strip labels
- whole-asset picker title/help/empty state
- exact-face stronger warning
- whole-asset unlink action
- revoked owner messaging if needed

Do not introduce hardcoded UI strings.

## Hidden / blocked / manual interaction plan

- Hidden faces remain exact-face-only state.
- Blocked faces remain exact-face-only state.
- Whole-asset links may coexist with blocked faces on the same asset.
- Whole-asset links do not clear blocked or hidden state.
- Whole-asset links do not populate any face `currentLink`.
- Whole-asset links do not change asset review summary logic for unresolved faces.
- Manual face box creation remains the preferred way to refine from whole-asset ownership to exact-face ownership later.

Chosen blocked coexistence rule:

- allow whole-asset links when blocked faces exist
- keep the asset blocked if any blocked face exists

This preserves the meaning of blocked faces as unresolved relevant face state.

## Export / downstream plan

### Chosen widening

Add minimal support for whole-asset links in `project-export.ts`.

Add a new loaded record type, for example:

- `ProjectExportWholeAssetLinkRecord`

Read from `asset_assignee_links` and join assignee display data through `project_face_assignees`.

### JSON changes

Widen export metadata unions from:

- `"face" | "asset_fallback"`

to:

- `"face" | "whole_asset"`

Apply to:

- `linkedConsents`
- `linkedAssignees`
- per-consent linked assets

Chosen behavior:

- exact-face export stays unchanged
- whole-asset links appear in `linkedAssignees`
- consent-backed whole-asset links also appear in `linkedConsents`
- recurring whole-asset links remain assignee-only, just like recurring exact-face links
- `detectedFaces` stays exact-face-only

### Legacy fallback handling

During 061, the export path should stop emitting new `asset_fallback` rows from the old fallback table and instead emit `whole_asset` from `asset_assignee_links`.

Backfilled old fallback rows therefore become export-visible through the new model.

## Future-compatibility note for video support

The chosen model is suitable as a future base for video-wide linking because:

- it is asset-scoped, not face-scoped
- it supports both one-off and recurring assignees through the same identity bridge
- it does not depend on current photo materialization face ids

061 does not add any video logic, frame logic, or tracking logic.

## Security and reliability considerations

- Resolve tenant and project scope server-side from auth and route params.
- Validate asset scope server-side before every write.
- Resolve assignee server-side from `consentId` or `projectProfileParticipantId`.
- Reject new one-off whole-asset links for revoked consents.
- Reject new recurring whole-asset links without active signed project recurring consent.
- Preserve existing whole-asset rows if the underlying consent later becomes revoked; show revoked state in reads and export.
- Use upsert on `(asset_id, project_face_assignee_id)` for retry-safe create.
- Use idempotent delete for retry-safe remove.
- Keep eager exact-face supersession compact and deterministic.
- Do not add auto whole-asset linking or any asset-level suppression table in 061.

## Edge cases

- Zero-face photo with consent-backed whole-asset link created from legacy route should map to the new generic table and still behave correctly.
- Photo with faces can receive a whole-asset link from preview without selecting a face.
- Same assignee exact-face-linked already should block whole-asset create with explicit conflict metadata.
- Same assignee whole-asset-linked then manually exact-face-linked should eagerly remove the whole-asset row.
- Same assignee whole-asset-linked then auto exact-face-linked should eagerly remove the whole-asset row during reconcile.
- Different-assignee exact-face and whole-asset rows may coexist on the same asset.
- Blocked face plus whole-asset link still leaves asset blocked.
- Hidden face plus whole-asset link stays hidden and ignored.
- Revoked whole-asset owners remain visible as revoked in preview strip and export.
- Duplicate create/delete requests converge without duplicate rows or orphaned state.

## Test plan

### New dedicated feature coverage

Add `tests/feature-061-link-consent-to-whole-asset.test.ts` covering at least:

- one-off whole-asset create and duplicate create idempotency
- one-off whole-asset delete and duplicate delete idempotency
- recurring whole-asset create and delete
- reject recurring whole-asset create when project recurring consent is missing, pending, or revoked
- reject whole-asset create when same assignee already has an exact-face link
- same-assignee manual exact-face save eagerly removes whole-asset row
- same-assignee auto exact-face reconcile eagerly removes whole-asset row
- different-assignee exact-face and whole-asset coexistence on the same asset
- blocked-face coexistence without bypass
- hidden-face behavior unchanged
- export metadata includes `whole_asset` rows in `linkedAssignees` and consent-backed rows in `linkedConsents`

### Existing test updates

Update:

- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
  - zero-face legacy compatibility path still works through the new whole-asset model
- `tests/feature-044-asset-preview-linking-ux-improvements.test.ts`
  - preview/lightbox add-person menu now enables whole-asset flow
- `tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`
  - hidden-face preview state remains unchanged when whole-asset owners exist
- `tests/feature-047-manual-face-box-creation-in-asset-preview.test.ts`
  - manual face creation still works as the refinement path after whole-asset linking
- `tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`
  - blocked-face preview state still has no `currentLink` even with whole-asset owners present
- `tests/feature-058-project-local-assignee-bridge.test.ts`
  - recurring whole-asset export and preview ownership behavior

### Security and scope tests

- tenant and project scoping enforced on new whole-asset routes
- invalid consent or participant outside the project is rejected
- revoked consent create is rejected
- unauthenticated requests fail

## Implementation phases

### Phase 1: Schema, model, and compatibility seam

- add `asset_assignee_links` migration with RLS, policies, indexes, and backfill from old fallback rows
- add whole-asset load helpers
- add whole-asset create/delete helpers
- switch steady-state whole-asset storage to the new table
- keep old consent-side fallback contract as a compatibility wrapper

### Phase 2: Write routes and exact-face integration

- add `whole-asset-links` POST and DELETE routes
- wire one-off and recurring assignee resolution through existing assignee helpers
- add same-assignee exact-face conflict handling on whole-asset create
- add eager delete of same-assignee whole-asset rows in exact-face manual helpers
- add eager delete of same-assignee whole-asset rows in exact-face reconcile

### Phase 3: Preview/lightbox read-model and UI support

- widen `preview-faces` read model with `wholeAssetLinks`
- add `whole-asset-candidates` read route
- enable the current `Link to entire asset` action
- add whole-asset strip, picker tray, and unlink tray
- add i18n keys

### Phase 4: Export widening

- add whole-asset export record loads
- emit `linkMode: "whole_asset"`
- keep exact-face export behavior unchanged

### Phase 5: Tests and cleanup

- add new feature 061 integration coverage
- update boundary tests
- verify old fallback compatibility behavior
- remove any now-unused steady-state references to old fallback tables from main code paths

## Explicitly deferred work

- auto whole-asset linking
- any matcher or queue redesign
- tenant-directory-wide arbitrary add-person search
- video/frame-level implementation
- asset-level suppression table
- blocked-at-asset-level workflows
- replacing exact-face ownership with whole-asset ownership
- full removal of old fallback tables in the same cycle

## Concise implementation prompt

Implement Feature 061 as an additive manual-only whole-asset ownership feature. Add a new project-scoped `asset_assignee_links` table keyed by `(asset_id, project_face_assignee_id)` with tenant/project asset scope, assignee scope, `link_source = 'manual'`, and standard RLS policies. Backfill existing `asset_consent_manual_photo_fallbacks` rows into this new table by resolving consent-backed `project_face_assignee_id`, then switch steady-state whole-asset reads and writes to the new table while keeping the old consent-side `mode: "asset_fallback"` route contract as a temporary compatibility wrapper. Add asset-centric `POST/DELETE /api/projects/[projectId]/assets/[assetId]/whole-asset-links` routes that accept the same contract style as current face assignment writes: `identityKind + consentId` or `identityKind + projectProfileParticipantId`, then resolve assignees server-side with the existing `ensureProjectConsentFaceAssignee(...)` and `ensureProjectRecurringConsentFaceAssignee(...)` helpers. Reject one-off whole-asset creates for revoked consents and recurring whole-asset creates without active signed project recurring consent. Keep exact-face ownership stronger than whole-asset ownership by rejecting whole-asset create when the same assignee already has an exact-face link on the asset and by eagerly deleting same-assignee whole-asset rows whenever a manual or auto exact-face link becomes current. Widen `getAssetPreviewFaces(...)` and the `preview-faces` route to include a `wholeAssetLinks` collection, add `GET /api/projects/[projectId]/assets/[assetId]/whole-asset-candidates` for the new asset-level picker, and update `ProjectAssetPreviewLightbox` so the existing `Link to entire asset` menu item opens a real picker tray, exact-face linked people remain in the current strip, and whole-asset linked owners render in a separate strip/tray with unlink support. Preserve hidden, blocked, and manual-face semantics exactly: whole-asset links never populate face `currentLink`, never clear blocked or hidden state, and may coexist with blocked faces without marking the asset resolved. Widen export minimally in `project-export.ts` so exact-face export stays unchanged while whole-asset links emit `linkMode: "whole_asset"` in `linkedAssignees` and, for consent-backed rows, also in `linkedConsents`. Add a dedicated `tests/feature-061-link-consent-to-whole-asset.test.ts` plus focused updates to the existing 031/044/045/047/048/058 boundary tests for one-off and recurring create/delete, exact-face supersession, blocked coexistence, hidden behavior, export metadata, and no exact-face regression.
