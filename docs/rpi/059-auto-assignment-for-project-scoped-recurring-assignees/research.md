# Feature 059 Research: Auto Assignment for Project-Scoped Recurring Assignees

## Goal

Define the smallest coherent next step after Feature 058 that lets project-scoped recurring assignees participate in canonical exact-face auto assignment beside one-off project consent assignees, while reusing the existing face-link ownership model, matching pipeline, queue/continuation robustness, reconciliation flow, and manual override semantics.

This research is grounded in live code and schema. Prior RPI docs were used as context and architecture history only.

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
- `docs/rpi/056-recurring-profile-headshots-and-matching-materialization-foundation/research.md`
- `docs/rpi/056-recurring-profile-headshots-and-matching-materialization-foundation/plan.md`
- `docs/rpi/057-project-matching-integration-for-ready-recurring-profiles/research.md`
- `docs/rpi/057-project-matching-integration-for-ready-recurring-profiles/plan.md`
- `docs/rpi/058-project-local-assignee-bridge-for-profile-backed-matches/research.md`
- `docs/rpi/058-project-local-assignee-bridge-for-profile-backed-matches/plan.md`

### Older matching and robustness docs

- `docs/rpi/025-matching-queue-robustness/research.md`
- `docs/rpi/025-matching-queue-robustness/plan.md`
- `docs/rpi/026-prevent-partial-materialization-orchestration-failures/research.md`
- `docs/rpi/026-prevent-partial-materialization-orchestration-failures/plan.md`
- `docs/rpi/029-complete-bounded-matching-fanout/research.md`
- `docs/rpi/029-complete-bounded-matching-fanout/plan.md`
- `docs/rpi/030-continuation-retry-reliability/research.md`
- `docs/rpi/030-continuation-retry-reliability/plan.md`
- `docs/rpi/034-materialization-repair-and-overlay-regressions/research.md`
- `docs/rpi/034-materialization-repair-and-overlay-regressions/plan.md`
- `docs/rpi/035-embedding-compare-response-alignment-bug/research.md`
- `docs/rpi/035-embedding-compare-response-alignment-bug/plan.md`

### Live schema, code, and tests verified

- Canonical face ownership and writes:
  - `src/lib/matching/photo-face-linking.ts`
  - `src/lib/matching/consent-photo-matching.ts`
  - `src/lib/matching/project-face-assignees.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment/route.ts`
  - `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
  - `supabase/migrations/20260415210000_058_project_face_assignee_bridge.sql`
- Preview, candidate, and project asset UI:
  - `src/lib/matching/asset-preview-linking.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
  - `src/components/projects/project-asset-preview-lightbox.tsx`
  - `src/components/projects/previewable-image.tsx`
- Matching pipeline, worker, reconcile, repair, compare, and source enumeration:
  - `src/lib/matching/auto-match-jobs.ts`
  - `src/lib/matching/auto-match-worker.ts`
  - `src/lib/matching/auto-match-reconcile.ts`
  - `src/lib/matching/auto-match-repair.ts`
  - `src/lib/matching/auto-match-fanout-continuations.ts`
  - `src/lib/matching/materialized-face-compare.ts`
  - `src/lib/matching/recurring-materialized-face-compare.ts`
  - `src/lib/matching/project-recurring-sources.ts`
  - `src/lib/matching/project-matching-progress.ts`
  - `src/lib/matching/face-materialization.ts`
- Hidden, blocked, manual-face, and fallback seams:
  - `src/lib/matching/manual-asset-faces.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/manual-faces/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]/route.ts`
- Participation and recurring-readiness surfaces:
  - `src/lib/projects/project-participants-service.ts`
  - `src/components/projects/project-participants-panel.tsx`
  - `src/lib/profiles/profile-consent-service.ts`
  - `src/lib/profiles/profile-headshot-service.ts`
- Boundary tests:
  - `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
  - `tests/feature-044-asset-preview-linking-ux-improvements.test.ts`
  - `tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`
  - `tests/feature-047-manual-face-box-creation-in-asset-preview.test.ts`
  - `tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`
  - `tests/feature-055-project-participants-foundation.test.ts`
  - `tests/feature-055-project-participants-ui.test.ts`
  - `tests/feature-057-project-matching-ready-recurring-profiles.test.ts`
  - `tests/feature-058-project-local-assignee-bridge.test.ts`

## Verified current boundary after Feature 058

### 1. Canonical exact-face ownership is already assignee-based, but auto apply is still consent-only

Live schema after `20260415210000_058_project_face_assignee_bridge.sql`:

- `project_face_assignees` is the project-local owner registry.
- `project_face_assignees.assignee_kind` is either:
  - `project_consent`
  - `project_recurring_consent`
- `asset_face_consent_links.project_face_assignee_id` is now required.
- `asset_face_consent_links.consent_id` is nullable for recurring-backed rows.
- `asset_face_consent_links` still keeps a compatibility check:
  - `link_source <> 'auto' or consent_id is not null`

That last check is a hard live blocker for recurring auto links today.

### 2. `project_face_assignees` is project-local, additive, and already used by manual exact-face writes

Live helper behavior in `src/lib/matching/project-face-assignees.ts`:

- one-off assignees are created idempotently by `(tenant_id, project_id, consent_id)`
- recurring assignees are created idempotently by `(tenant_id, project_id, recurring_profile_consent_id)`
- recurring assignee creation currently requires:
  - project participant exists
  - active project-specific recurring consent exists
- recurring assignee creation does not currently check `face_match_opt_in` on the active project recurring consent row

### 3. Exact-face storage still preserves the 031/058 ownership model

Live exact-face invariants remain:

- one current owner row per face via `asset_face_consent_links.asset_face_id` primary key
- one current face per assignee within an asset via `asset_face_consent_links (tenant_id, project_id, asset_id, project_face_assignee_id)` unique index
- manual and auto rows share one canonical table
- manual-over-auto precedence is enforced in `reconcilePhotoFaceCanonicalStateForAsset(...)`
- hidden, blocked, manual-face, and zero-face fallback semantics remain separate tables and flows

### 4. Recurring evidence already exists in the matching pipeline

Verified live recurring source and compare boundary:

- `resolveReadyProjectRecurringSource(...)` already enumerates project-scoped recurring sources
- readiness currently requires:
  - project participant exists
  - active baseline recurring consent exists
  - baseline `face_match_opt_in = true`
  - current uploaded recurring headshot exists
  - current recurring headshot materialization is usable
  - current selected recurring face exists
- recurring fan-out already uses the same queue and continuation model:
  - `photo_to_recurring_profiles`
  - `recurring_profile_to_photos`
- recurring compare jobs persist into:
  - `asset_project_profile_face_compares`
  - `asset_project_profile_face_compare_scores`
- repair, replay, retry, and progress already know about recurring compare jobs and continuations

### 5. Recurring preview candidates and current linked owners already exist, but only partially

Verified live preview behavior:

- `getAssetPreviewFaces(...)` already renders linked owners for:
  - `project_consent`
  - `project_recurring_consent`
- `getAssetPreviewFaceCandidates(...)` already ranks consent and recurring evidence side by side
- recurring candidate rows already expose:
  - `identityKind = "recurring_profile_match"`
  - `assignable`
  - `assignmentBlockedReason`
  - `projectConsentState`
- linked face summaries already show recurring owner state as active or revoked

But the recurring preview path is still incomplete:

- recurring candidate rows only appear when recurring compare evidence exists for that face
- eligible recurring participants are not added as unscored manual-link rows
- recurring candidate `headshotThumbnailUrl` is always `null`
- recurring linked owners do not expose current recurring headshot thumbnail or preview URLs
- overlay badges in `project-asset-preview-lightbox.tsx` only receive consent headshot thumbnails, not recurring ones

This means the current UI does not fully satisfy the requested manual-linking behavior for unmatched faces or newly created manual face boxes, because those faces can have no recurring compare evidence and therefore no recurring candidate rows.

### 6. Manual recurring linking already works server-side

Verified live write behavior:

- `POST /api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment`
  already accepts:
  - `identityKind = "project_consent"`
  - `identityKind = "recurring_profile_match"`
- `manualLinkPhotoToRecurringProjectParticipant(...)` resolves the project recurring assignee and reuses the same generic exact-face write helper as one-off linking
- manual-created faces can be linked through the same face-assignment route because they live in `asset_face_materialization_faces` and the write helper is face-id based, not consent-only

### 7. Manual-only vs auto-only after 058

What recurring can already do after 058:

- appear as evidence-backed preview candidates
- appear as current linked owners in preview
- be manually assigned to a face
- be manually unlinked through the generic face assignment route
- flow into export metadata through canonical exact-face ownership

What recurring still cannot do after 058:

- auto-own a face
- participate in canonical auto winner selection
- create an auto row in `asset_face_consent_links`
- create or clear face suppressions on manual displacement/unlink
- appear as unscored eligible manual-link options when no recurring face evidence exists
- use recurring headshot thumbnails in preview candidate trays or linked-owner summaries
- participate in zero-face fallback

### 8. The current auto-reconcile path is still consent-only in several concrete places

Verified blockers in `reconcilePhotoFaceCanonicalStateForAsset(...)`:

- only `asset_consent_face_compares` are loaded
- only consent state is loaded for contender eligibility
- only consent-backed auto links are considered current auto rows
- only consent-backed suppressions are read
- contender identity is `consentId`
- auto assignee creation is hard-wired to `ensureProjectConsentFaceAssignee(...)`

Verified blockers outside reconcile:

- `asset_face_consent_links_auto_link_requires_consent_check` rejects recurring auto rows
- `manualUnlinkPhotoFaceAssignment(...)`, hide, and block only create suppressions for consent-backed rows
- `processCompareRecurringProfileMaterializedPairJob(...)` persists recurring compare rows but does not call canonical reconcile
- project recurring consent grant/revoke does not currently enqueue any asset-level canonical reconcile path

### 9. The current recurring replay hooks are source-driven, not assignee-eligibility-driven

Existing replay producers already fire on:

- project participant add
- recurring baseline opt-in grant
- recurring baseline revoke
- recurring headshot activation and selection changes

But they do not currently fire on:

- project-specific recurring consent grant
- project-specific recurring consent revoke

Also, even if a participant replay were triggered on project-specific consent sign/revoke, existing recurring fan-out would usually see the same compare keys and schedule no compare jobs. That means existing replay alone is not enough to activate or remove recurring auto ownership when only the project consent gate changes.

## Current schema, routes, components, and helpers involved

### Canonical ownership and write layer

- `project_face_assignees`
- `asset_face_consent_links`
- `asset_face_consent_link_suppressions`
- `asset_consent_manual_photo_fallbacks`
- `asset_consent_manual_photo_fallback_suppressions`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/project-face-assignees.ts`

### Compare and source evidence

- One-off:
  - `asset_consent_face_compares`
  - `asset_consent_face_compare_scores`
  - `asset_consent_match_candidates`
- Recurring:
  - `asset_project_profile_face_compares`
  - `asset_project_profile_face_compare_scores`
  - `resolveReadyProjectRecurringSource(...)`

### Worker, continuation, replay, repair, and progress

- `face_match_jobs`
- `face_match_fanout_continuations`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-fanout-continuations.ts`
- `src/lib/matching/auto-match-reconcile.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/lib/matching/project-matching-progress.ts`

### Preview and manual-link UI surface

- `src/lib/matching/asset-preview-linking.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment/route.ts`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`

## Options considered

### Option A: Keep recurring assignees manual-only and only polish the preview UI

Rejected.

Why:

- does not answer the feature goal
- preserves the exact live gap after 058
- leaves recurring evidence outside canonical auto ownership

### Option B: Widen the current canonical face reconcile path to mixed contenders

Recommended.

Why:

- reuses the exact-face ownership model already widened in 058
- reuses current recurring evidence from 057
- reuses the current worker, continuation, repair, replay, and progress system
- keeps auto ownership centralized in one place instead of creating a second recurring-only apply path
- only requires additive changes where current code is still consent-shaped

### Option C: Introduce a new generic assignment engine and broad async redesign

Rejected.

Why:

- reopens already-hardened pipeline work from 025/026/029/030
- is not necessary because recurring source enumeration, compare persistence, and exact-face assignee storage already exist
- would expand 059 beyond a normal bounded RPI cycle

## Recommended auto-assignment model

Use `reconcilePhotoFaceCanonicalStateForAsset(...)` as the single canonical auto-owner writer, but widen its contender loading from consent-only to mixed assignee contenders.

Recommended shape:

1. Keep current compare production unchanged.
2. Keep one-off compare persistence unchanged.
3. Keep recurring compare persistence unchanged.
4. Change canonical reconcile to load both:
   - consent compare contenders from `asset_consent_face_compares`
   - recurring compare contenders from `asset_project_profile_face_compares`
5. Normalize them into one in-memory contender shape:
   - `projectFaceAssigneeId`
   - `assigneeKind`
   - `consentId` nullable
   - `projectProfileParticipantId` nullable
   - `recurringProfileConsentId` nullable
   - `winningAssetFaceId`
   - `confidence`
   - `stableContenderKey`
6. Keep the current face-level winner resolution loop and current auto-row upsert/delete behavior.

This keeps the worker architecture intact. The widening happens in canonical reconcile, not in a new matcher or a new ownership pipeline.

### Why the current pipeline can be widened instead of redesigned

The live repo already has all required primitives:

- one exact-face canonical table that can point at either assignee kind
- recurring compare rows with the same winner fields needed by reconcile
- recurring currentness validation helpers
- recurring fan-out continuations inside the same hardened queue model
- repair and progress logic that already includes recurring jobs

What is missing is not scoring infrastructure. What is missing is the last mile from recurring compare evidence into canonical exact-face ownership.

## Recommended recurring auto-eligibility rules

Recurring auto eligibility should require all of the following:

1. Project participant exists.
2. `resolveReadyProjectRecurringSource(...)` returns a current ready source.
   - This already implies active baseline recurring consent plus baseline `face_match_opt_in = true`.
3. Active project-specific recurring consent exists for that participant in that project.
4. The project-specific recurring consent is not revoked.
5. For auto assignment, the project-specific recurring consent should also require `face_match_opt_in = true`.
6. The face is not hidden.
7. The face is not blocked.
8. The face is a detector face, not a manual-created face.
9. No assignee suppression blocks that face and assignee pair.

Recommended explicit answer to the core business gate question:

- `added to project + baseline face-match opt-in` is not enough for auto ownership
- active project-specific recurring consent remains mandatory

Current live code already proves that project-specific recurring consent is the intended legal gate for manual recurring assignment. 059 should keep that for auto ownership and make it explicit.

### Note on project-specific recurring `face_match_opt_in`

Live 058 manual assignee creation does not enforce this flag today. For 059, the safer bounded recommendation is:

- require project-specific `face_match_opt_in = true` for auto assignment
- leave any broader manual-link eligibility tightening as a plan-phase decision

That keeps 059 conservative for automation without forcing a broader manual-link redesign up front.

## Recommended mixed contender and one-owner-per-face behavior

### Mixed contenders

One-off consent-backed and recurring assignees should both be allowed to contend for the same face.

They should use the same:

- current materialization checks
- hidden and blocked exclusions
- detector-face-only auto rule
- manual-over-auto exclusion
- confidence threshold

### Winner selection

Reuse the current deterministic winner logic and widen the tiebreak key.

Recommended order:

1. higher confidence
2. lower `stableContenderKey` lexicographically

Recommended `stableContenderKey`:

- one-off: `consent:<consent_id>`
- recurring: `recurring_consent:<recurring_profile_consent_id>`

This preserves deterministic replay behavior without depending on random assignee UUID generation order.

### One current owner per face

No new owner table is needed.

Existing storage already preserves:

- one current owner row per `asset_face_id`
- one current assignee per asset via `(asset_id, project_face_assignee_id)` uniqueness

The new requirement is only that canonical reconcile produce mixed assignee winners into that same table.

## Recommended manual-linking continuity

### What can remain unchanged

- the generic face assignment route
- the generic face unlink route
- force-replace behavior
- block-clear-on-save behavior
- manual-created faces staying exact-face rows in `asset_face_materialization_faces`
- hidden and blocked write semantics
- zero-face fallback staying consent-only

### What must widen

The face candidate API must widen beyond evidence-only recurring rows.

Current live gap:

- active one-off consents are already added as unscored candidate rows
- recurring participants are only added when there is recurring compare evidence for that face

That means unmatched detected faces and new manual face boxes cannot reliably show recurring manual-link options today.

Recommended bounded change:

- keep evidence-backed recurring rows as scored rows
- additionally include eligible recurring assignees as `scoreSource = "unscored"` rows in the face candidate tray
- limit this to already project-scoped participants, not tenant-wide search

Recommended recurring manual-link candidate rule:

- include project participants with active project-specific recurring consent
- if a ready recurring source exists, include current recurring headshot thumbnail where available
- if scored face evidence exists for the selected face, use that score and rank
- otherwise surface the row as unscored but assignable

This is the smallest change that satisfies the requested manual-link behavior without adding arbitrary tenant-directory search.

## Recommended headshot-thumbnail behavior in preview and manual-link UI

Recurring-profile-backed candidates and linked owners should use the current recurring profile headshot thumbnail and preview image where available.

Live code already has the pieces:

- recurring headshot storage and current-headshot lookup
- `getRecurringProfileHeadshotSignedPreviewUrl(...)`
- components that already accept a generic `headshotThumbnailUrl`

Recommended bounded UI/data change:

- add recurring `headshotThumbnailUrl` and `headshotPreviewUrl` to:
  - linked owner summaries
  - face candidate rows
- update `project-asset-preview-lightbox.tsx` to use:
  - consent headshot when consent-backed
  - recurring headshot when recurring-backed
- keep face crop fallback only when no recurring headshot exists

This should be mostly a read-model widening. The component structure can stay largely unchanged.

## Recommended hidden, blocked, manual, and fallback interaction rules

### Hidden

- hidden faces stay hidden
- hidden faces remain excluded from mixed contender loading
- preview candidate writes should still require restore first

### Blocked

- blocked faces stay blocked
- blocked faces remain excluded from auto assignment
- existing block-clear-on-manual-save behavior can be reused unchanged

### Manual-created faces

- manual-created faces remain manual-only
- do not auto assign to `face_source = "manual"`
- manual linking to either assignee type should continue to work

This preserves both 047 and the current `isDetectorCurrentFace(...)` rule.

### Zero-face fallback

- keep zero-face fallback separate
- keep recurring zero-face fallback deferred

No new recurring fallback model is required for 059.

## Required data-model and suppression changes

### 1. Remove the consent-only auto-row constraint

Required change:

- drop or replace `asset_face_consent_links_auto_link_requires_consent_check`

Without that, recurring auto winners cannot be stored.

### 2. Introduce generic exact-face assignee suppression

Recurring suppression is now required.

Why:

- once recurring assignees can auto-own faces, manual unlink or manual replace must prevent immediate auto reapply
- current suppressions are consent-keyed only
- current recurring manual unlink/replace writes no suppression at all

Recommended smallest safe model:

- add `asset_face_assignee_link_suppressions`
- key it by `(asset_face_id, project_face_assignee_id)`
- keep zero-face fallback suppressions separate and consent-only

Why a new generic exact-face suppression table is preferred now:

- exact-face canonical ownership is already assignee-based
- recurring auto rows cannot be represented cleanly in the current consent-FK suppression table
- adding a second recurring-only suppression table would split the same precedence rule across two storage paths

Recommended migration posture:

- backfill current consent suppressions into the new assignee suppression table by resolving `project_face_assignee_id`
- switch reconcile, unlink, replace, hide, and block flows to read and write the assignee suppression table
- keep the old consent suppression table only if a short compatibility bridge is needed during implementation

### 3. No new compare persistence tables are required

Not required for 059:

- new matcher pipeline
- recurring likely-candidate table
- widening current compare tables into one polymorphic compare table

Existing compare tables are enough. Reconcile can union them in memory.

### 4. Preview candidate read widening is required

Required read-model change:

- include unscored assignable recurring participants in `getAssetPreviewFaceCandidates(...)`
- include recurring headshot thumbnail URLs in preview responses

## Is recurring suppression now required?

Yes.

Feature 058 could defer recurring suppression because recurring could not auto-own a face.

Feature 059 cannot.

Minimum safe rule:

- any manually displaced or manually unlinked current assignee should create exact-face assignee suppression, regardless of whether the displaced owner was one-off or recurring
- generic assignee suppressions should be consumed by canonical auto reconcile only
- zero-face fallback suppressions remain separate and one-off only

### Important source-change edge case

Generic assignee suppression introduces one new parity question:

- one-off headshot replacement currently clears consent suppressions
- recurring headshot replacement or selection changes should likely clear recurring assignee suppressions for the affected participant before replay, or they will persist forever across source changes

Recommended bounded direction:

- mirror current one-off behavior
- clear recurring assignee suppressions on recurring source change before replaying matching

This should be carried into the plan phase explicitly.

## Security and reliability considerations

- Keep all assignee resolution server-side.
- Never trust client-provided tenant ids, consent state, or assignee ids as authoritative.
- Auto reconcile must revalidate:
  - tenant scope
  - project scope
  - current materialization ids
  - recurring source currentness
  - current project recurring consent state
  - hidden and blocked state
  - manual-over-auto precedence
- Reuse the existing idempotent upsert/delete behavior in canonical reconcile.
- Continue using the current queue, continuation, and repair model from 025/026/029/030.
- Do not redesign fan-out or compare orchestration.

### Reliability gap that 059 must close

Project recurring consent grant or revoke can change auto eligibility without changing compare rows.

That means 059 needs a bounded way to reconcile already-compared assets when only assignee eligibility changed.

Recommended smallest reuse-first answer:

- reuse `reconcile_project` as the trigger surface
- add a project-recurring-consent gate-change path that locates affected asset ids from existing recurring compare rows and current recurring auto links for the participant
- run canonical face reconcile for those assets without requiring new compare rows first

This is still a widening of existing replay, not a new async subsystem.

## Edge cases

- Recurring auto winner later displaced manually:
  - create assignee suppression for the displaced recurring assignee on that face
  - do not allow immediate reapply
- Recurring auto winner manually unlinked:
  - create assignee suppression for that face and assignee
- Recurring project consent revoked after auto link exists:
  - recommended bounded behavior is to mirror current one-off semantics and preserve historical current rows while blocking new auto application
  - preview should show revoked owner state
- Recurring source replaced or selection face changed:
  - stale recurring compare rows remain stored but must be ignored by currentness checks
  - clear recurring assignee suppressions before replay, mirroring one-off headshot replacement behavior
- Mixed one-off and recurring contenders with equal confidence:
  - resolve deterministically by the stable contender key
- Duplicate worker or replay execution:
  - canonical reconcile remains idempotent
  - queue and continuation hardening from 025/029/030 remains reusable
- Manual-created face boxes:
  - remain auto-excluded
  - still need recurring unscored candidate rows for manual linking

## Explicitly deferred work

- tenant-directory-wide recurring profile search in preview/manual-linking
- one-off/profile identity merge
- broad consent backend redesign
- broad queue or worker redesign
- recurring zero-face fallback
- repeated-same-person-multiple-faces-in-one-photo support
- consent-side review-session redesign
- broad export or DAM redesign beyond whatever already reads canonical face ownership

## Recommended smallest usable 059 slice

This research recommends a slice closest to "Candidate 2" from the prompt:

1. Recurring assignees become eligible for canonical auto assignment.
2. Canonical auto reconcile is widened to mixed assignee contenders.
3. Existing recurring compare persistence and queue/continuation flows are reused unchanged.
4. A generic exact-face assignee suppression model is added.
5. Face candidate trays are widened so unmatched faces and manual face boxes can still be manually linked to eligible recurring assignees.
6. Recurring headshot thumbnails are shown in candidate and linked-owner UI where available.
7. Hidden, blocked, manual-face, and zero-face fallback behavior stays unchanged otherwise.

## Open decisions for the plan phase

1. Should project-specific recurring `face_match_opt_in` gate only auto assignment, or both auto and manual recurring assignment?
2. Should generic assignee suppression fully replace `asset_face_consent_link_suppressions` in 059, or should the plan use a one-cycle dual-read migration bridge?
3. What is the exact bounded replay path when project recurring consent grant or revoke changes auto eligibility without changing source currentness?
4. Should revoked recurring auto rows be preserved exactly like current revoked one-off auto rows, or should plan phase tighten that behavior specifically for recurring auto rows?
5. How should recurring headshot preview URLs be batch-loaded most cleanly for preview read models:
   - reuse `getRecurringProfileHeadshotSignedPreviewUrl(...)` directly
   - or add a small batched helper for current recurring headshots

## Research conclusion

The live repo after Feature 058 is already structurally prepared for mixed exact-face ownership:

- canonical exact-face rows already point at project-local assignees
- recurring evidence already flows through the hardened matching pipeline
- preview already understands mixed owner identity

What still blocks Feature 059 is not a missing matcher or missing async backbone. It is a narrow set of consent-shaped assumptions at the canonical apply and suppression layers.

The recommended implementation direction is therefore:

- widen the existing canonical face reconcile path, do not replace it
- reuse existing recurring compare rows as contender inputs
- add generic exact-face assignee suppression
- add the minimum preview/manual-link read widening needed for recurring unscored manual-link rows and recurring headshot thumbnails

That keeps 059 additive, production-oriented, and well-bounded for a normal RPI cycle.
