# Feature 058 Plan - Project-Local Assignee Bridge for Profile-Backed Matches

## Inputs and ground truth

Required repo docs read in order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/058-project-local-assignee-bridge-for-profile-backed-matches/research.md`

Targeted live verification only:

- `src/lib/matching/photo-face-linking.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `src/lib/matching/asset-preview-linking.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/lib/projects/project-participants-service.ts`
- `src/components/projects/project-participants-panel.tsx`
- `src/lib/profiles/profile-consent-service.ts`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`
- `src/lib/matching/project-recurring-sources.ts`
- `src/lib/matching/recurring-materialized-face-compare.ts`
- `supabase/migrations/20260415193000_057_project_matching_ready_recurring_profiles.sql`
- `tests/feature-057-project-matching-ready-recurring-profiles.test.ts`
- `src/lib/matching/manual-asset-faces.ts`
- `tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`
- `src/lib/project-export/project-export.ts`

Live repository code and schema are the source of truth. Feature 058 research is the source of truth for the bounded product recommendation.

## Verified current planning boundary

### Exact-face ownership and writes are centralized, but still consent-shaped

Live write behavior is already centralized in `src/lib/matching/photo-face-linking.ts`, even though the public project route still goes through `src/lib/matching/consent-photo-matching.ts` and `/api/projects/[projectId]/consents/[consentId]/assets/links`.

Verified facts:

- `manualLinkPhotoToConsent(...)` and `manualUnlinkPhotoFromConsent(...)` own manual face assignment and removal.
- `manualLinkPhotoToConsent(...)` already handles:
  - manual conflict and force-replace behavior
  - deleting displaced links
  - writing `manual_replace` suppressions
  - clearing blocked state before save
  - clearing consent fallback rows
  - deleting likely-candidate rows
  - canonical reconciliation after save
- `reconcilePhotoFaceCanonicalStateForAsset(...)` already owns:
  - current materialization cleanup
  - hidden / blocked exclusion
  - manual-over-auto precedence
  - current compare filtering
  - current headshot materialization filtering
  - auto link upsert and auto cleanup

The schema is still consent-foreign-keyed:

- `asset_face_consent_links`
- `asset_face_consent_link_suppressions`
- `asset_consent_manual_photo_fallbacks`
- `asset_consent_manual_photo_fallback_suppressions`

All four still key exact ownership or its suppression history to `public.consents`.

### Project preview reads are structurally reusable, but identity is hard-wired to consent

`src/lib/matching/asset-preview-linking.ts` already gives the right project-centric surface:

- face overlay list
- linked face state
- face candidate tray
- blocked / hidden states
- linked-person strip

But its shapes are still consent-only:

- current linked face summary carries `consentId`
- face candidates carry `consentId`
- asset-level link candidates carry `consentId`
- consent href generation is built into the read model

`getAssetPreviewFaceCandidates(...)` is also still consent-only in how it ranks and filters:

- `asset_consent_face_compare_scores`
- `asset_consent_face_compares`
- `asset_consent_match_candidates`
- active project `consents`

No recurring candidate rows are surfaced yet.

### Project participant and recurring project consent state are already available

Feature 055 already gives the state model 058 needs. Live code confirms:

- `project_profile_participants` is the project-scoped participant anchor.
- `recurring_profile_consents` and `recurring_profile_consent_requests` carry project-scoped consent state with `consent_kind = 'project'`.
- project participant panel data already distinguishes:
  - `missing`
  - `pending`
  - `signed`
  - `revoked`

This state is already present in `src/lib/projects/project-participants-service.ts` and rendered in `src/components/projects/project-participants-panel.tsx`.

### Recurring evidence is already project-scoped and must stay that way

Feature 057 live code confirms:

- ready recurring sources are resolved from `project_profile_participants`
- replay is enqueued per project participant
- recurring compare evidence is stored in:
  - `asset_project_profile_face_compares`
  - `asset_project_profile_face_compare_scores`
- compare rows key to `project_profile_participant_id`
- tests verify recurring evidence exists without creating canonical consent links

Feature 058 must not widen beyond this boundary. No tenant-directory-wide recurring profile scoring is allowed.

### Hidden / blocked / manual / zero-face seams already exist and should be reused

Live behavior already verified:

- hidden faces must be restored before linking
- blocked faces can be cleared and manual save already clears the block on link
- blocking a linked face removes the existing link and writes suppression when needed
- manual-created faces are current materialization faces with `face_source = 'manual'`
- zero-face fallback is implemented through consent-only fallback tables and is separate from exact face ownership

058 should reuse these seams, not re-invent them.

### Export is still consent-shaped

`src/lib/project-export/project-export.ts` currently assumes:

- exported linked face rows are keyed by `consentId`
- asset metadata carries `linkedConsentId`
- linked people arrays are `linkedConsents`
- per-consent export JSON is built from `public.consents`

This is the main downstream seam once recurring exact ownership becomes real.

## Recommendation

Implement 058 as a canonical project-local assignee bridge for exact-face ownership now, but do it as a narrow additive widening of the existing exact-face path rather than a new parallel recurring-only ownership system.

Concrete choice:

- introduce a new project-local assignee bridge table
- reuse the existing exact-face link table and helper flow
- add the bridge id into the exact-face link table
- keep `consent_id` as a compatibility column for one-off rows
- do not widen zero-face fallback
- do not widen consent-side review
- do not add recurring auto assignment

This is preferable to a parallel transitional recurring-only link table because the live repo already centralizes exact-face conflict, replace, block-clear, cleanup, and reconciliation behavior in one place. Splitting canonical ownership into separate consent and recurring tables would fork those invariants immediately.

## Chosen bridge architecture

### Chosen architecture

Use a new canonical project-local assignee bridge plus a narrow widening of the existing exact-face link table.

The bridge becomes the canonical owner identity for face links in 058.

The compatibility strategy is:

- exact face link rows always point at a `project_face_assignee`
- one-off links continue to carry `consent_id` for compatibility and reuse
- recurring links carry the assignee bridge id and leave `consent_id` null
- auto assignment remains consent-only and therefore keeps using consent-backed rows only
- fallback remains consent-only and unchanged

### Canonical ownership widening in 058

Feature 058 is intentionally widening exact-face ownership from a consent-shaped-only model to a mixed canonical assignee model now.

This is not just a preview-only bridge and not just a UI helper.

In 058:

- `project_face_assignee_id` becomes the canonical owner key for exact-face face links
- `project_face_assignees` becomes the canonical project-local owner registry for exact-face ownership
- `consent_id` remains for one-off compatibility and reuse, not as the canonical future owner shape

Implementation should therefore treat the bridge as part of canonical ownership storage and write behavior, not as an optional projection layered on top of unchanged consent-only ownership.

### Why this beats a narrower dual-write split in this repo

A narrower split path would mean:

- consent-backed links remain canonical in `asset_face_consent_links`
- recurring-backed links would need a second canonical table or a second write flow
- read models would have to union two ownership systems
- face-level exclusivity and replace semantics would be split across two storage paths

That is more dangerous than adding one bridge id to the existing canonical table and refactoring the core write helper once.

### What stays compatibility-shaped in 058

- existing table names can remain unchanged
- consent route shape can remain for consent-side flows
- `asset_face_consent_link_suppressions` remains consent-shaped
- `asset_consent_manual_photo_fallbacks` remains consent-shaped
- `asset_consent_manual_photo_fallback_suppressions` remains consent-shaped

Only exact face ownership itself is widened.

## Reuse-first integration strategy

### Reuse unchanged

Keep these behaviors and helpers intact as much as possible:

- `resolvePhotoState(...)`
- current materialization loading
- hidden-face checks
- blocked-face checks
- block-clear-on-manual-save behavior
- force-replace manual conflict behavior
- current compare filtering for consent auto links
- `reconcilePhotoFaceCanonicalStateForAsset(...)` auto winner selection logic
- recurring compare persistence and currentness filtering from 057
- worker / continuation / repair / retry / progress paths
- manual face creation and `face_source = 'manual'`

Implementation should adapt the existing exact-face linking path rather than create a second parallel recurring-only ownership path. The goal is to reuse the current manual link, unlink, replace, block-clear, and reconcile behavior as much as possible, with any new abstraction staying a narrow adapter around the current exact-face core rather than a redesign.

### Minimal places to widen

Only widen the code where identity is currently hard-coded to `consentId`:

- exact-face link row shape in `photo-face-linking.ts`
- manual link / unlink core in `photo-face-linking.ts`
- preview read shapes in `asset-preview-linking.ts`
- project preview save/remove actions in `project-asset-preview-lightbox.tsx`
- project preview write routes
- small export seam if included

### New server-side adapter layer

Add a dedicated helper module, e.g. `src/lib/matching/project-face-assignees.ts`, to own:

- assignee bridge resolution
- assignee bridge creation
- consent-backed assignee lookup
- recurring project-consent-backed assignee lookup
- assignee summary reads for preview
- recurring candidate consent-state resolution

This keeps the rest of the repo from learning recurring-consent internals directly.

## Exact scope boundary

### What becomes real in 058

- project preview face candidate trays show recurring-profile-backed candidate rows
- recurring candidate rows are visible even when non-assignable
- recurring candidate rows become assignable only when active project recurring consent exists
- a project-local assignee bridge exists server-side
- exact face ownership can point to either:
  - a one-off consent-backed assignee
  - a recurring project-consent-backed assignee
- manual assignment from project preview/lightbox can select recurring assignable candidates
- linked-face side panel can describe mixed owner identity

### What remains deferred

- tenant-directory-wide recurring source matching
- widening `getAssetPreviewLinkCandidates(...)` to arbitrary recurring add-person selection
- consent-side review session widening
- profile-backed auto assignment
- recurring zero-face fallback
- one-off/profile merge
- recurring consent backend redesign
- matcher / continuation / repair redesign
- broad export redesign

### Boundary confirmation

058 still only bridges already project-scoped recurring evidence from ready project participants.

## Exact schema/model plan

### 1. New bridge table

Add `public.project_face_assignees`.

Recommended columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `assignee_kind text not null`
- `consent_id uuid null`
- `recurring_profile_consent_id uuid null`
- `project_profile_participant_id uuid null`
- `recurring_profile_id uuid null`
- `created_at timestamptz not null default now()`

Recommended assignee kinds:

- `project_consent`
- `project_recurring_consent`

Recommended constraints:

- foreign key `(project_id, tenant_id)` -> `projects`
- foreign key `(consent_id, tenant_id, project_id)` -> `consents` for one-off rows
- foreign key from `recurring_profile_consent_id` to `recurring_profile_consents`
- foreign key from `project_profile_participant_id` to `project_profile_participants`
- partial unique index on `(tenant_id, project_id, consent_id)` where `assignee_kind = 'project_consent'`
- partial unique index on `(tenant_id, project_id, recurring_profile_consent_id)` where `assignee_kind = 'project_recurring_consent'`
- check constraint that only the columns valid for the chosen kind are populated

Lifecycle assumptions:

- one-off assignee rows are created lazily when needed or during exact-link backfill
- recurring assignee rows are created lazily when a recurring candidate becomes assignable or is written
- recurring assignee rows remain historical even if the underlying recurring consent is later revoked

### 2. Widen exact face link table, not fallback tables

Alter `public.asset_face_consent_links`:

- add `project_face_assignee_id uuid null`
- backfill it for existing consent-backed rows
- then enforce not null after backfill
- add foreign key from `project_face_assignee_id` to `project_face_assignees`
- add unique index on `(tenant_id, project_id, asset_id, project_face_assignee_id)`

Compatibility strategy:

- keep `consent_id` in place for 058
- consent-backed rows keep writing `consent_id`
- recurring-backed rows write `project_face_assignee_id` and leave `consent_id` null

Do not widen in 058:

- `asset_consent_manual_photo_fallbacks`
- `asset_consent_manual_photo_fallback_suppressions`

Those stay one-off consent-only because zero-face fallback is deferred.

### 3. Keep suppressions consent-shaped in 058

Do not widen `asset_face_consent_link_suppressions` to generic assignees in 058.

Reason:

- recurring auto assignment is deferred
- recurring candidates do not need suppression to prevent auto reapply in 058
- the existing suppression table is still needed for displaced consent-backed auto/manual rows

Behavioral rule:

- when a displaced owner is consent-backed, keep writing suppression rows exactly as today
- when a displaced owner is recurring-backed, do not write suppression rows in 058

### Recurring displacement and no-suppression behavior

No recurring suppression model is introduced in 058.

This is intentional because profile-backed auto assignment is deferred in 058. There is therefore no need to invent a partial recurring suppression system just to mirror consent-backed suppression behavior.

Implementation rule:

- when a recurring-linked face is displaced manually, only current ownership changes
- no recurring suppression row is written
- the implementation must not invent partial recurring suppression semantics
- consent-backed suppression behavior remains unchanged and must be reused exactly as it works today

### 4. Backfill plan

Migration backfill should:

1. create one-off `project_face_assignees` rows for all currently linked one-off face owners
2. populate `asset_face_consent_links.project_face_assignee_id`
3. leave fallback tables untouched

No recurring backfill is needed because recurring exact links do not exist yet.

## Exact canonical write plan

### New write abstraction

Refactor manual face linking around a generic internal target:

- `manualLinkPhotoToProjectAssignee(...)`
- `manualUnlinkPhotoFaceAssignment(...)`

Keep the existing public consent route behavior by adapting it:

- `/api/projects/[projectId]/consents/[consentId]/assets/links`
- resolve or create a `project_consent` assignee row
- call the generic helper

### New project preview route

Add a new project-centric preview route for face assignment only, for example:

- `POST /api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment`
- `DELETE /api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment`

Recommended POST body:

- `identityKind: "project_consent" | "recurring_profile_match"`
- `consentId?: string`
- `projectProfileParticipantId?: string`
- `forceReplace?: boolean`

Reason for this route shape:

- the preview UI should not need to know whether a bridge row already exists
- the server can resolve or create the assignee bridge idempotently
- recurring writes can be revalidated against current evidence and current consent state

### Manual assignment behavior by identity

For one-off consent candidates:

- reuse existing exact behavior
- resolve or create `project_consent` assignee
- write exact face link row with both:
  - `project_face_assignee_id`
  - `consent_id`

For recurring assignable candidates:

- require current recurring evidence for that face and participant
- require active project recurring consent for that profile and project
- resolve or create `project_recurring_consent` assignee
- write exact face link row with:
  - `project_face_assignee_id`
  - `consent_id = null`

### Reused write semantics

The generic helper should keep the current manual semantics:

- same hidden-face rejection
- same manual conflict and force-replace flow
- same replace behavior
- same block-clear-on-save behavior
- same idempotent already-linked result
- same post-write reconciliation call

The only widening is that current owner and target owner are assignee-based, not always consent-based.

### Unlink behavior

Preview unlink should move to the new project-centric DELETE route.

Behavior:

- remove the current exact face link row for that face
- if the removed owner is consent-backed, keep current suppression behavior for manual unlink
- if the removed owner is recurring-backed, just remove the exact link row
- do not touch zero-face fallback in 058

## Exact preview/read-model plan

### Candidate rows

Use one normalized candidate shape for project preview.

Recommended shape:

```ts
type AssetPreviewAssigneeCandidate = {
  candidateKey: string;
  identityKind: "project_consent" | "recurring_profile_match";
  assignable: boolean;
  assignmentBlockedReason:
    | null
    | "project_consent_missing"
    | "project_consent_pending"
    | "project_consent_revoked";
  fullName: string | null;
  email: string | null;
  headshotThumbnailUrl: string | null;
  rank: number | null;
  similarityScore: number | null;
  scoreSource: "current_compare" | "likely_candidate" | "unscored";
  currentAssetLink: { assetFaceId: string; faceRank: number | null } | null;
  consentId: string | null;
  projectProfileParticipantId: string | null;
  profileId: string | null;
  projectConsentState: "missing" | "pending" | "signed" | "revoked" | null;
};
```

Notes:

- one-off consent candidates populate `consentId`
- recurring candidates populate `projectProfileParticipantId`, `profileId`, `projectConsentState`
- only recurring candidates use `assignmentBlockedReason`
- `candidateKey` should be stable, e.g. `consent:<id>` or `participant:<id>`

### Candidate assembly

Keep the current consent candidate assembly unchanged.

Add recurring candidate assembly in the same read model:

- recurring score rows from `asset_project_profile_face_compare_scores`
- recurring compare rows from `asset_project_profile_face_compares`
- current recurring source filtering by:
  - current project participant
  - current recurring headshot materialization
  - current selected recurring face
  - current asset materialization
- project recurring consent state lookup for each matched profile

Do not add:

- tenant-wide recurring profile lookup
- recurring candidates to asset-level add-person menu

### Linked face side panel

Widen the linked owner shape from consent-only to assignee-based.

Recommended outer shape:

- `projectFaceAssigneeId`
- `identityKind`
- `linkSource`
- `matchConfidence`
- `displayName`
- `email`
- `ownerState`

Identity-specific detail:

- one-off owner includes current consent href and signed snapshot summary
- recurring owner includes project participant/profile summary and project recurring consent state

The panel layout can stay structurally the same. Only the owner summary model changes.

## Exact non-assignable recurring-state behavior

Recurring evidence visibility must map exactly as follows:

| State | Visible | Assignable |
| --- | --- | --- |
| recurring evidence + no project-specific recurring consent | yes | no |
| recurring evidence + pending project-specific recurring consent | yes | no |
| recurring evidence + active project-specific recurring consent | yes | yes |
| recurring evidence + revoked project-specific recurring consent | yes | no |

Assignment remains manual-only in 058.

UI behavior:

- show the recurring row in the same candidate tray
- disable selection for non-assignable rows
- show localized helper text for the blocked reason
- do not auto-create requests

## Hidden / blocked / manual / fallback interaction plan

### Hidden faces

- keep current hidden behavior unchanged
- hidden faces remain hidden in preview unless restored
- preview candidate reads for hidden faces should stay rejected
- recurring rows are not a bypass

### Blocked faces

- blocked faces stay visible as blocked in preview
- blocked trays may show recurring rows for context
- recurring rows follow the same assignable vs non-assignable rules
- saving an assignable recurring row should reuse the current block-clear-on-save path
- hide still requires block clear first

### Manual-linked faces

- manual current owner remains authoritative
- change-person flow can show recurring rows
- replace still requires the same conflict/force-replace semantics
- displaced consent-backed owners still write suppression rows
- displaced recurring owners do not add new suppression behavior in 058

### Manual-created faces

- no special widening needed
- if current recurring evidence exists for the manual face, show it
- no auto assignment onto manual-created faces

### Zero-face fallback

- no recurring widening
- no bridge writes into fallback tables
- existing consent-only fallback path remains untouched

## Security and reliability considerations

All business authority stays server-side.

### Write-time revalidation

Every preview assignment write must revalidate:

- authenticated user and tenant membership
- project scope
- asset scope
- current face materialization and current face id
- hidden-face state
- blocked-face state behavior
- current owner and manual conflict semantics
- target identity kind
- if one-off:
  - consent belongs to tenant and project
  - consent is active and not revoked
- if recurring:
  - project participant belongs to tenant and project
  - current recurring compare evidence exists for that face and participant
  - project recurring consent exists, belongs to the same project/profile, and is active

### Idempotency and duplicate clicks

- assignee bridge creation must be `upsert`-safe by unique key
- repeated POST on the same face/target should return `already_linked` or the same linked result
- repeated DELETE should be safe after the row is gone
- current consent request idempotency behavior remains unchanged

### Retry and replay safety

058 does not change:

- compare scheduling
- continuation fan-out
- worker retries
- repair
- progress accounting

The only new retry-sensitive writes are bridge resolution and exact face assignment, both of which should use deterministic unique keys and upsert-safe flows.

## Migration-radius / export decision

### Decision

Include export widening only if the final implementation really ships canonical mixed-owner exact-face links in 058.

Reason:

- once recurring exact links are real canonical owners, asset export metadata would otherwise silently omit them
- a full export redesign is out of scope
- a small additive widening prevents blind spots without changing the one-off consent export model

If implementation scope narrows before coding starts, or if the ownership migration choice changes, export widening can remain deferred safely.

### Exact export boundary

Keep unchanged:

- one-off consent export JSON files
- consent filename generation
- consent-side export payloads based on `public.consents`

Add only:

- asset metadata support for mixed assignee identity

Recommended additive export fields:

- keep existing `linkedConsentId` and `linkedConsents` for one-off rows
- add assignee-aware asset metadata fields such as:
  - `linkedAssigneeId`
  - `linkedIdentityKind`
  - `linkedOwners`

For recurring-linked faces, asset metadata can include:

- project participant id
- recurring profile id
- project recurring consent state
- link mode and source

Do not add recurring per-consent export files in 058.
Do not redesign export. Keep any 058 export change minimal, additive, and asset-metadata-only.

## Edge cases

- Ready recurring evidence appears after a face already has a manual one-off link:
  - candidate becomes visible
  - no displacement without explicit replace
- Project recurring consent becomes active after evidence already exists:
  - same recurring candidate flips from visible disabled to visible assignable
- Project recurring consent is revoked after a recurring manual link exists:
  - keep historical exact link row
  - show owner as revoked/inactive
  - exclude from future assignable recurring candidates
- Headshot replacement or selection change invalidates old recurring rows:
  - candidate reads must drop stale rows through currentness filtering
- Duplicate project participant add or recurring request actions:
  - unchanged from 055/057
- Preview double click on recurring assign:
  - bridge creation and link write stay idempotent

## Test plan

Add or update tests covering at least:

1. Preview candidate tray shows recurring rows as visible non-assignable when project recurring consent is missing.
2. Preview candidate tray shows recurring rows as visible non-assignable when project recurring consent is pending.
3. Preview candidate tray shows recurring rows as visible non-assignable when project recurring consent is revoked.
4. Preview candidate tray shows recurring rows as assignable when project recurring consent is active.
5. Manual recurring assignment from preview writes:
   - assignee bridge row
   - exact face link row with `project_face_assignee_id`
   - no recurring fallback row
6. Duplicate recurring assignment is idempotent.
7. Replacing a consent-backed manual owner with recurring keeps manual replace semantics and writes consent suppression for the displaced consent.
8. Replacing a recurring manual owner with one-off consent keeps manual replace semantics without inventing recurring suppression behavior.
9. Assigning an active recurring candidate to a blocked face clears the block before save.
10. Hidden face behavior remains unchanged.
11. Manual-created faces can show recurring evidence but remain manual-only.
12. Stale recurring candidate rows disappear after recurring headshot replacement or face reselection.
13. Preview add-person asset-level candidate flow does not widen to arbitrary recurring profiles.
14. Profiles not added to the project do not surface as recurring candidates.
15. Asset export metadata includes recurring-linked owners if the export widening is included.

## Implementation phases

### Phase 1 - Schema and bridge helpers

- migration for `project_face_assignees`
- migration to add `project_face_assignee_id` to `asset_face_consent_links`
- backfill existing one-off exact links
- add `src/lib/matching/project-face-assignees.ts`
- add assignee resolution and recurring consent-state helpers

### Phase 2 - Read-model widening

- widen `src/lib/matching/asset-preview-linking.ts`
- add recurring candidate rows into preview face candidates
- widen linked-face owner summary shape
- keep asset-level add-person candidates consent-only

### Phase 3 - Manual assignment route and core write integration

- add new project-centric preview assignment route
- refactor `photo-face-linking.ts` around generic assignee resolution
- adapt consent route to the generic core or keep it as a thin consent-backed adapter
- preserve current manual conflict, replace, block-clear, and reconciliation behavior

### Phase 4 - Project preview UI widening

- widen `src/components/projects/project-asset-preview-lightbox.tsx`
- switch preview save/remove actions to the new project-centric assignment route
- render recurring rows with assignable vs non-assignable states
- widen linked-face side panel owner presentation
- add i18n keys for recurring labels and blocked reasons

### Phase 5 - Export seam, tests, and cleanup

- add the small asset export metadata widening if included by the final canonical ownership scope
- add coverage for recurring preview rows and bridge writes
- add export coverage if export widening is included
- keep consent-side review and zero-face fallback unchanged

## Explicitly deferred work

- scoring all recurring profiles in the tenant directory
- recurring candidates in consent-side review flows
- recurring auto assignment
- recurring-backed asset fallback
- recurring request auto-generation from candidate trays
- one-off/profile merge
- recurring consent backend redesign
- matcher / continuation / repair redesign
- broad export redesign

## Concise implementation prompt

Implement Feature 058 by adding a server-side `project_face_assignees` bridge and widening the existing exact-face link path so project preview can show recurring-profile-backed candidates from already project-scoped recurring evidence and manually assign them only when active project recurring consent exists. Reuse the current `photo-face-linking.ts` conflict, replace, hidden, blocked, and reconciliation behavior; do not widen source enumeration, consent-side review, auto assignment, or zero-face fallback. Widen project preview read models and the lightbox UI to support mixed assignee identity, keep recurring candidates visible but disabled for missing/pending/revoked project consent, and add only a small additive asset-export widening if needed to avoid mixed-owner blind spots.
