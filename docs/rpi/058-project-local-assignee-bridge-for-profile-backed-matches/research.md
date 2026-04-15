# Feature 058 Research - Project-Local Assignee Bridge for Profile-Backed Matches

## Inputs reviewed

Core repo docs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`

Foundational RPI context:

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
- `docs/rpi/049-recurring-profiles-and-consent-management-foundations/research.md`
- `docs/rpi/049-recurring-profiles-and-consent-management-foundations/plan.md`
- `docs/rpi/055-project-participants-and-mixed-consent-intake/research.md`
- `docs/rpi/055-project-participants-and-mixed-consent-intake/plan.md`
- `docs/rpi/056-recurring-profile-headshots-and-matching-materialization-foundation/research.md`
- `docs/rpi/056-recurring-profile-headshots-and-matching-materialization-foundation/plan.md`
- `docs/rpi/057-project-matching-integration-for-ready-recurring-profiles/research.md`
- `docs/rpi/057-project-matching-integration-for-ready-recurring-profiles/plan.md`

Live code and schema verified directly:

- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-fanout-continuations.ts`
- `src/lib/matching/project-recurring-sources.ts`
- `src/lib/matching/recurring-materialized-face-compare.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/profiles/profile-headshot-service.ts`
- `src/lib/profiles/profile-consent-service.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/photo-link-review-dialog.tsx`
- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/components/projects/project-participants-panel.tsx`
- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`
- `supabase/migrations/20260415160000_056_recurring_profile_headshots_matching_foundation.sql`
- `supabase/migrations/20260415193000_057_project_matching_ready_recurring_profiles.sql`
- `tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`
- `tests/feature-055-project-participants-foundation.test.ts`
- `tests/feature-055-project-participants-ui.test.ts`
- `tests/feature-057-project-matching-ready-recurring-profiles.test.ts`

Note:

- The requested 053 plan path in the prompt is not present under that exact folder name in the repo. The live file is `docs/rpi/053-recurring-consent-history-and-inline-profile-detail/plan.md`.

## Verified current boundary after Feature 057

### 0. Explicit guardrail for Feature 058

Feature 058 must not widen recurring source enumeration beyond the current project-scoped model.

This guardrail comes directly from the live 055 plus 057 boundary:

- 055 established mixed participation as project-scoped through `project_profile_participants`
- 055 kept project-specific profile consent in the recurring-profile consent domain with `consent_kind = 'project'`
- 057 established recurring matching as a second project matching source family for ready recurring project participants
- 057 did not authorize tenant-directory-wide recurring matching against project assets

That means:

- 058 is not allowed to score all recurring profiles in the tenant directory against project assets
- 058 is not allowed to treat tenant-wide recurring profile existence as a project matching source
- 058 only bridges already project-scoped recurring evidence into candidate visibility and assignment
- 058 is not a new source-enumeration feature and must not reopen recurring source discovery beyond ready project participants

The only recurring evidence in scope for 058 is evidence already produced from ready project participants through the Feature 055 plus Feature 057 model:

- `project_profile_participants`
- project-scoped recurring consent state in `recurring_profile_consents` with `consent_kind = 'project'`
- ready recurring project participant matching evidence from Feature 057

### 1. Feature 057 added real project-scoped recurring-profile evidence

Live schema and worker code now persist recurring-profile-backed matching evidence in parallel structures:

- `asset_project_profile_face_compares`
- `asset_project_profile_face_compare_scores`

The recurring source identity used to schedule and validate currentness is project-local and derived from:

- `project_profile_participants`
- active baseline `recurring_profile_consents` with `face_match_opt_in = true`
- the current uploaded recurring headshot
- the current recurring headshot materialization
- the selected recurring headshot face

The worker path is live:

- `reconcile_project` can enqueue recurring replay for ready project participants
- fan-out continuations now support `photo_to_recurring_profiles` and `recurring_profile_to_photos`
- `compare_recurring_profile_materialized_pair` jobs persist compare rows and per-face score rows

Feature 057 tests explicitly confirm the current limit:

- recurring compare evidence is stored
- no `asset_face_consent_links` rows are created from recurring evidence
- no `asset_consent_match_candidates` rows are created from recurring evidence

### 2. Current preview and candidate APIs still only see consent-backed identity

`src/lib/matching/asset-preview-linking.ts` remains consent-centric:

- `getAssetPreviewFaces(...)` loads exact links from `asset_face_consent_links`, then resolves linked identity through `consents` and `subjects`
- `getAssetPreviewFaceCandidates(...)` only ranks candidates from:
  - `asset_consent_face_compare_scores`
  - `asset_consent_face_compares`
  - `asset_consent_match_candidates`
  - active project `consents`
- `getAssetPreviewLinkCandidates(...)` also loads only active project `consents`

The returned shapes are still hard-wired to `consentId`, consent headshot thumbnails, and consent detail links.

The routes simply forward those read models:

- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`

### 3. Current project preview UI is structurally reusable, but its identity model is not

The asset preview/lightbox already has the right operator surface:

- `src/components/projects/project-asset-preview-lightbox.tsx`

It supports:

- linked face side panel
- unlinked face candidate tray
- blocked face tray
- hidden face tray
- change-person flow
- manual exact-face assignment

But the types and actions are still `consentId`-based throughout:

- linked face details assume a consent summary
- candidate rows assume `consentId`
- save/remove/change-person posts to `/api/projects/[projectId]/consents/[consentId]/assets/links`

### 4. Exact-face ownership is still technically one-off-consent-backed, not generic project-local identity

This is the most important live constraint.

`supabase/migrations/20260403170000_031_face_level_photo_linking.sql` shows that all current canonical exact-face tables foreign-key to `public.consents`, not to a generic project assignee abstraction:

- `asset_face_consent_links`
- `asset_face_consent_link_suppressions`
- `asset_consent_manual_photo_fallbacks`
- `asset_consent_manual_photo_fallback_suppressions`

The write path in `src/lib/matching/photo-face-linking.ts` enforces the same model:

- `MatchingScopeInput` requires `consentId`
- `assertConsentInProject(...)` validates against `public.consents`
- `manualLinkPhotoToConsent(...)` and `manualUnlinkPhotoFromConsent(...)` write `consent_id`
- auto reconciliation in `reconcilePhotoFaceCanonicalStateForAsset(...)` also chooses winners by `consent_id`

This means:

- active project-specific recurring consent is a valid business authorization
- but it is not a technically assignable exact-face identity in the current schema
- project participation alone is even further from assignability

### 5. Why 057 evidence is not enough for actual linking

057 evidence is sufficient for:

- recurring source readiness
- project-scoped fan-out
- compare persistence
- per-face score persistence
- progress accounting

057 evidence is not sufficient for:

- preview candidate trays
- change-link flows
- exact-face manual assignment
- exact-face auto assignment
- zero-face fallback assignment
- consent-side review sessions

The reason is not missing score quality. The reason is missing project-local assignable identity that the exact-face model can write.

## Current schema, routes, components, and helpers involved

Schema and persistence:

- `public.consents`
- `public.subjects`
- `public.project_profile_participants`
- `public.recurring_profile_consent_requests`
- `public.recurring_profile_consents`
- `public.asset_face_consent_links`
- `public.asset_face_consent_link_suppressions`
- `public.asset_consent_manual_photo_fallbacks`
- `public.asset_consent_manual_photo_fallback_suppressions`
- `public.asset_consent_face_compares`
- `public.asset_consent_face_compare_scores`
- `public.asset_consent_match_candidates`
- `public.asset_project_profile_face_compares`
- `public.asset_project_profile_face_compare_scores`

Project preview and assignment routes:

- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`

Project preview and mixed-participant UI:

- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/components/projects/project-participants-panel.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`

Consent-side review UI that should mostly remain unchanged in 058:

- `src/components/projects/photo-link-review-dialog.tsx`
- `src/components/projects/consent-asset-matching-panel.tsx`

Server-side matching and readiness helpers:

- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/project-recurring-sources.ts`
- `src/lib/matching/recurring-materialized-face-compare.ts`
- `src/lib/projects/project-participants-service.ts`

## What should count as the project-local assignable identity

### Verified answer

The business-level assignability requirement is:

- active project-specific recurring consent for the same profile in the same project

But the technical assignable identity cannot be the `recurring_profile_consents` row directly because current exact-face ownership is foreign-keyed to `public.consents`.

### Resulting model

Feature 058 needs two layers:

1. Business authorization:
   - active `recurring_profile_consents` row where:
     - `consent_kind = 'project'`
     - `project_id = current project`
     - `profile_id = matched recurring profile`
     - `revoked_at is null`

2. Technical exact-face assignee:
   - a new project-local assignee bridge row backed by that active project recurring consent

That bridge row is needed because live code cannot safely "project" a project recurring consent into the current exact-face model without new structure.

Primary plan-phase decision:

- whether the bridge becomes a new canonical foreign-key target for exact-face ownership now
- or whether 058 uses a narrower transitional projection or dual-write strategy around the current consent-shaped exact-face tables

Research does not resolve that implementation choice because the live code does not yet force a single answer. It does make the boundary explicit:

- active project recurring consent is the business gate
- some project-local assignee bridge is still required for the write path

This is the main implementation ambiguity that plan must resolve. The rest of the 058 recommendation is intentionally narrower and already fixed by research:

- only already project-scoped recurring evidence is in scope
- candidate visibility widens in project preview
- assignment remains manual-only
- consent-side review, zero-face fallback, and tenant-wide source expansion stay out of scope

## Options considered

### Option A - Project participation alone is assignable

Rejected.

Why:

- `project_profile_participants` is targeting state, not signed authorization
- it has no project-local signed text/version snapshot
- it has no revocation lifecycle equivalent to current face ownership expectations
- it would weaken the live "no consent means no assignment" rule from Feature 048

### Option B - Active project-specific recurring consent alone is assignable

Rejected as a complete answer.

Why:

- it is the correct business precondition
- but current exact-face tables, review session tables, and write APIs all point to `public.consents`
- no live route or canonical table can write `recurring_profile_consents.id`

Conclusion:

- active project-specific recurring consent is necessary
- it is not sufficient without a technical assignee bridge

### Option C - Mirror project recurring consent into the current `subjects -> consents` model

Not recommended for 058.

Why it looks tempting:

- it would let many current routes keep using `consentId`
- it would keep export and preview reads closer to today's shape

Why it is not the smallest safe choice:

- `public.consents` is invite-backed and requires `subject_id` plus `invite_id`
- current public signing, revoke, and event semantics are built around one-off invite flow
- 055 explicitly kept signed profile-backed project consent outside the current `consents` table
- introducing shadow invites, subjects, revoke tokens, and consent rows is close to a consent-backend redesign

### Option D - New project-local assignee bridge backed by active project recurring consent

Recommended.

Why:

- preserves project-specific recurring consent as the real authorization artifact
- avoids pretending recurring project consent is a one-off invite consent
- gives exact-face assignment a project-local identity that can outlive UI-only read tricks
- keeps the recurring scoring source identity separate from canonical ownership identity
- is additive and can be limited to the exact-face cluster plus project preview reads

## Recommended bounded bridge model

### Recommendation

Use a dedicated project-local assignee bridge.

Recommended conceptual shape:

- one project-local assignee concept for exact-face ownership
- one-off assignee backed by `public.consents`
- recurring assignee backed by active project `public.recurring_profile_consents`

Recommended 058 boundary:

- active project recurring consent is the required business gate
- the assignee bridge row is the technical write target for exact-face ownership
- preview candidate visibility can resolve assignability by checking both

### Why this is the smallest coherent bridge

It cleanly separates:

- matching evidence
- candidate visibility
- assignable project-local identity
- canonical exact-face ownership

It also avoids:

- one-off/profile merge
- stuffing recurring identity into `subjects`
- mutating public invite consent semantics

## Recommended relationship between profile-backed evidence and project-specific recurring consent

Recommended rule set:

- recurring compare evidence remains keyed by project participant and profile source
- project participation remains the project-local source enumeration anchor
- active project recurring consent determines whether that source is legally assignable in this project
- the assignee bridge resolves the active project recurring consent into the exact-face ownership model

So the identity ladder becomes:

1. `project_profile_participants`
   - "this reusable profile is part of this project"
2. `asset_project_profile_face_compares` / `_scores`
   - "this project participant/profile source matches this face"
3. active project `recurring_profile_consents`
   - "this reusable profile has signed project-specific authorization"
4. project-local assignee bridge row
   - "this project authorization can now be written into exact-face ownership"

## Recommended candidate visibility and assignment behavior

### Compact candidate-state mapping

| State | Visibility | Assignable in 058 |
| --- | --- | --- |
| recurring evidence + no project-specific recurring consent | visible | no |
| recurring evidence + pending project-specific recurring consent | visible | no |
| recurring evidence + active project-specific recurring consent | visible | yes |
| recurring evidence + revoked project-specific recurring consent | visible | no |

Assignment remains manual-only in 058 for all profile-backed candidates.

### Before assignability exists

When recurring evidence exists but no active project recurring consent exists:

- show the candidate in project preview candidate trays
- mark it non-assignable
- label the reason clearly:
  - missing project consent
  - pending project consent
  - revoked project consent

This is the recommended equivalent of prompt Option B.

Reason:

- hiding the row wastes real evidence and leaves operators confused
- auto-generating requests is broader workflow work and should stay deferred

### When assignability exists

When recurring evidence exists and an active project recurring consent exists:

- show the candidate as assignable
- manual selection should be allowed from the project preview/lightbox flow
- the server should resolve or create the assignee bridge row idempotently
- canonical exact-face ownership should write through the assignee bridge, not raw profile evidence

### Auto-assignment in 058

Recommended answer: do not support profile-backed auto assignment in 058.

Use manual-review-only first.

Why:

- current auto reconciliation is entirely consent-keyed
- mixed-source auto winner selection would require broader canonical apply changes
- revocation and historical preservation rules become more complex once auto ownership can originate from a recurring bridge
- manual-review-first still creates immediate operator value

## Recommended fit with preview/lightbox and candidate tray UX

### Project asset preview is the primary surface to widen

The smallest useful UX slice is in:

- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/lib/matching/asset-preview-linking.ts`
- the two preview routes under `src/app/api/projects/[projectId]/assets/...`

Recommended read-model widening:

- keep the current layout structure
- widen candidate rows from consent-only to a union or generic assignee shape
- expose enough metadata to distinguish:
  - one-off consent candidate
  - recurring profile match candidate
  - assignable vs non-assignable
  - blocked reason when non-assignable

Recommended candidate row additions:

- `identityKind`: `project_consent` or `recurring_profile_match`
- `assignable`: boolean
- `assignmentBlockedReason`: null or:
  - `project_consent_missing`
  - `project_consent_pending`
  - `project_consent_revoked`
- recurring display summary:
  - `projectProfileParticipantId`
  - `profileId`
  - `fullName`
  - `email`
  - `projectConsentState`

Recommended labels:

- consent-backed rows keep current consent presentation
- recurring rows should be visibly labeled as profile-backed
- non-assignable recurring rows should show a disabled action state plus helper copy

Recommended action behavior:

- current consent-backed rows keep current behavior
- recurring assignable rows should use a new generic project-local assignment route, not the existing `/consents/[consentId]/assets/links` route
- recurring non-assignable rows should not post any write

### Current linked-face side panel should become assignee-based, not consent-only

The side panel can stay structurally the same, but its data model should no longer assume every current link is a one-off consent.

Recommended change:

- rename the project preview read shape from "consent summary" to "assignee summary"
- one-off rows still show consent detail links
- recurring rows should instead show participant/profile context plus project recurring consent state

### Consent-side matching panel should stay out of scope for 058

`src/components/projects/consent-asset-matching-panel.tsx` and `photo-link-review-dialog.tsx` are intentionally scoped to one specific one-off `consentId`.

Do not widen them in 058.

Why:

- they are anchored to consent-specific review sessions
- they do not solve mixed identity in a project-centric way
- widening them now would expand 058 into a broader assignee redesign

## Hidden, blocked, manual, and fallback interaction rules

These rules should remain unchanged.

### Hidden

- hidden faces stay hidden
- preview candidate route should keep rejecting hidden faces until restored
- non-assignable recurring rows should not bypass hidden state

### Blocked

- blocked faces stay blocked
- blocked face trays may still show recurring evidence for operator context
- assignment remains disabled unless the blocked face is cleared or the current manual-link behavior that clears block on save is deliberately reused
- no recurring bridge may bypass blocked-face semantics

### Manual-over-auto

- manual exact links remain authoritative
- recurring evidence may be shown in change-person flows
- recurring evidence must not displace an existing manual winner without the same explicit replace behavior used today

### Manual faces

- manual face boxes remain non-auto
- recurring evidence may be shown for a manual face if current compare evidence exists
- 058 should not introduce auto assignment onto manual-created faces

### Zero-face fallback

Keep zero-face fallback separate in 058.

Reason:

- zero-face fallback is not evidence-backed exact-face ownership
- widening it to a recurring assignee bridge would add scope without helping the core matched-face use case

## Smallest usable 058 slice

Recommended slice:

1. Show profile-backed candidates in project asset preview candidate trays.
2. Mark them assignable only when an active project recurring consent exists.
3. Add a dedicated project-local assignee bridge for exact-face ownership.
4. Allow manual assignment from project preview/lightbox only.
5. Do not add profile-backed auto assignment.
6. Do not widen consent-side review queues in this feature.
7. Do not widen zero-face fallback in this feature.

This is closest to:

- Candidate 2 from the prompt, but with one necessary refinement:
  - active project recurring consent is the business gate
  - a dedicated project-local assignee bridge is the technical gate

## Migration-risk callout for plan phase

The main architectural risk in 058 is not recurring scoring. It is the migration radius once linked-face ownership stops being strictly consent-shaped.

The plan phase must re-verify the impact of the bridge choice on at least these seams:

- preview read models
- exact-face write APIs
- linked-face side panel owner summaries
- export assumptions where current linked identity is still modeled as `consentId`

This research does not recommend an export redesign. It only flags export as a seam that may be affected once mixed assignee identity becomes real canonical ownership rather than evidence-only context.

The plan phase should treat this as a migration-radius problem first and a UI-widening problem second. The risk is not that recurring evidence exists. The risk is that the canonical owner shape may stop being "`consentId` everywhere" once the bridge becomes writable.

## Security and reliability considerations

- All assignee resolution must stay server-side.
- Never accept tenant id, project consent state, or assignee kind from the client as trusted.
- Assignment writes must re-validate:
  - tenant scope
  - project scope
  - face currentness
  - hidden/blocked/manual precedence
  - current recurring source currentness
  - active project recurring consent
- Assignee bridge creation should be idempotent and safe to retry.
- Duplicate preview/lightbox actions should collapse to the existing linked result where possible.
- Read models should only surface recurring compare rows tied to the current recurring headshot materialization and selected face, the same way current consent reads filter to current headshots.
- Revoked project recurring consent should block new assignment through that bridge but should not silently rewrite historical exact-face ownership already made through an explicit manual action; current one-off revoked-consent behavior already preserves history rather than auto-deleting all prior links.

## Edge cases

- Ready recurring evidence appears after a face already has a manual link:
  - show the candidate, but manual current owner still wins until an explicit replace action.
- Project recurring consent is missing:
  - show disabled recurring row with clear helper state.
- Project recurring consent is pending:
  - show disabled recurring row with pending state, not assignable.
- Project recurring consent is later revoked after assignment:
  - preserve the historical link, show revoked/inactive assignee state, exclude from new assignable candidates.
- Blocked face receives recurring evidence:
  - evidence may be visible in blocked-face review, but no bypass of blocked state.
- Hidden face receives recurring evidence:
  - hidden state still suppresses candidate tray actions until restored.
- Recurring headshot selection changes or headshot is replaced:
  - stale compare rows must disappear from candidate reads through currentness filtering, not by trusting old persisted evidence.
- Preview posts duplicate assignment requests:
  - assignee bridge and canonical link writes should remain retry-safe and idempotent.

## Explicitly deferred work

- automatic creation of project consent requests from recurring match evidence
- batch send/follow-up workflow changes
- one-off/profile merge
- subject model redesign
- stuffing recurring project consent into the current public invite consent flow
- profile-backed auto assignment
- consent-side review session widening
- recurring-backed zero-face fallback
- broad DAM/export redesign
- broad lightbox redesign beyond the minimum label/state widening needed for mixed candidates

## Open decisions for the plan phase

- Exact assignee bridge table shape:
  - whether the new bridge should be a single generic assignee table or a narrower recurring-assignee bridge plus a generic read abstraction
- Exact canonical write migration strategy:
  - widen current exact-face tables to a generic assignee key now, or dual-write legacy consent ids for one-off rows during transition
- Whether project export needs a small additive widening in the same feature to avoid mixed-assignment blind spots, or can remain deferred safely
- Exact route shape for project preview assignment:
  - likely a new project-centric face assignment endpoint rather than overloading the consent route
- Exact preview read-model contract:
  - union candidate rows vs one normalized assignee candidate shape
- Whether blocked-face trays should show all non-assignable recurring rows, or only the strongest one with helper text
- Whether the linked-face side panel should link operators back to:
  - project participants section
  - recurring profile detail
  - both

The most important still-open decision is the bridge write strategy:

- canonical new foreign-key target now
- or narrower transitional projection or dual-write strategy for 058

That decision should be made by re-checking the live migration radius, not by revisiting tenant-wide source enumeration or re-opening profile scoring scope.

Everything else should stay constrained by the already-verified 058 boundary:

- no scoring of all recurring profiles in the tenant directory
- no one-off/profile merge
- no consent-side review widening
- no profile-backed auto assignment
- no zero-face fallback widening

## Verified live boundary for plan phase

The plan phase should re-verify these concrete live seams rather than repeat broad research:

- Current exact-face ownership write path:
  - `src/lib/matching/photo-face-linking.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
  - `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- Current preview read model and candidate tray path:
  - `src/lib/matching/asset-preview-linking.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
  - `src/components/projects/project-asset-preview-lightbox.tsx`
- Current project participation and project recurring consent state surfaces:
  - `src/lib/projects/project-participants-service.ts`
  - `src/components/projects/project-participants-panel.tsx`
  - `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`
- Current blocked, hidden, manual, and fallback interaction seams:
  - `src/lib/matching/photo-face-linking.ts`
  - `src/lib/matching/asset-preview-linking.ts`
  - `src/lib/matching/manual-asset-faces.ts`
  - `tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`
- Current recurring project-scoped evidence boundary:
  - `src/lib/matching/project-recurring-sources.ts`
  - `src/lib/matching/recurring-materialized-face-compare.ts`
  - `tests/feature-057-project-matching-ready-recurring-profiles.test.ts`
- Current export seam that may be affected by mixed assignee identity:
  - `src/lib/project-export/project-export.ts`

## Research conclusion

Feature 057 successfully added recurring-profile-backed scoring evidence to project matching, but the live repository still treats exact-face ownership as a one-off `public.consents` problem. The smallest safe next step is not to reuse project participation directly and not to pretend project recurring consent is already a current `consentId`. The correct bounded bridge is:

- active project-specific recurring consent as the required business authorization
- a new project-local assignee bridge as the technical exact-face identity
- project preview candidate visibility before assignability
- manual assignment only in 058

That keeps matching evidence, project-local authorization, and canonical ownership distinct, preserves current hidden/blocked/manual rules, avoids broad consent redesign, and gives operators a usable mixed-participant project review flow.
