# Feature 056 Research: Recurring Profile Headshots and Matching Materialization Foundation

## Inputs reviewed

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/049-recurring-profiles-and-consent-management-foundations/research.md`
- `docs/rpi/049-recurring-profiles-and-consent-management-foundations/plan.md`
- `docs/rpi/050-recurring-profile-directory-foundation/research.md`
- `docs/rpi/050-recurring-profile-directory-foundation/plan.md`
- `docs/rpi/051-baseline-recurring-consent-request-foundation/research.md`
- `docs/rpi/051-baseline-recurring-consent-request-foundation/plan.md`
- `docs/rpi/052-baseline-request-management/research.md`
- `docs/rpi/052-baseline-request-management/plan.md`
- `docs/rpi/053-recurring-consent-history-and-profile-detail/research.md`
- `docs/rpi/053-recurring-consent-history-and-inline-profile-detail/plan.md`
- `docs/rpi/054-baseline-follow-up-actions/research.md`
- `docs/rpi/054-baseline-follow-up-actions/plan.md`
- `docs/rpi/055-project-participants-and-mixed-consent-intake/research.md`
- `docs/rpi/055-project-participants-and-mixed-consent-intake/plan.md`
- `docs/rpi/006-headshot-consent/research.md`
- `docs/rpi/006-headshot-consent/plan.md`
- `docs/rpi/019-face-materialization-deduped-embedding-pipeline/research.md`
- `docs/rpi/019-face-materialization-deduped-embedding-pipeline/plan.md`
- `docs/rpi/025-matching-queue-robustness/research.md`
- `docs/rpi/025-matching-queue-robustness/plan.md`
- `docs/rpi/029-complete-bounded-matching-fanout/research.md`
- `docs/rpi/029-complete-bounded-matching-fanout/plan.md`
- `docs/rpi/030-continuation-retry-reliability/research.md`
- `docs/rpi/030-continuation-retry-reliability/plan.md`
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
- Live schema and code relevant to:
  - recurring profiles, recurring consents, and project participants
  - public and protected headshot upload/replacement flows
  - face materialization persistence and direct detection
  - matching worker, fan-out, repair, and compare paths
  - profile and project pages
  - i18n message files
  - exact-face photo linking and candidate reads
  - asset preview lightbox, hidden faces, blocked faces, and manual faces

## Verified current headshot/materialization boundary

### Current headshots are consent-centric, not profile-centric

Verified in live schema and code:

- `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`
- `src/app/api/public/invites/[token]/headshot/route.ts`
- `src/app/api/public/invites/[token]/headshot/[assetId]/finalize/route.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/consent/submit-consent.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`

Current behavior:

- Headshots are stored as `assets` with `asset_type = 'headshot'`.
- Headshots become a current matching source only through `asset_consent_links`.
- Protected replacement is tied to a signed project `consent_id`, not to `recurring_profiles`.
- Replacement clears consent-specific suppressions and auto-links, then attempts to enqueue `consent_headshot_ready`.

There is no live recurring-profile headshot table, profile headshot link, canonical selected-face metadata, or recurring-profile matching-ready field.

### Current face materialization already persists all detected faces

Verified in:

- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `src/lib/matching/face-materialization.ts`

Current behavior:

- `asset_face_materializations` stores one materialization row per asset version with face counts, source image metadata, `usable_for_compare`, and `unusable_reason`.
- `asset_face_materialization_faces` stores all detected faces for that materialization, including `face_rank`, `detection_probability`, `face_box`, and `embedding`.
- The current headshot rule is narrow:
  - exactly one face: usable
  - zero faces: unusable `no_face`
  - multiple faces: unusable `multiple_faces`

This means the detector output already preserves enough information to support a later canonical-face choice, but the current compare-ready rule rejects multi-face headshots before any profile-side selection can occur.

### The repo already has a proven direct single-asset materialization path

Verified in:

- `src/app/api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state/route.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/face-materialization.ts`

Current behavior:

- `getManualPhotoLinkState(...)` attempts direct materialization for one photo asset in-request.
- If direct materialization fails or is still unavailable, it falls back to `materialize_asset_faces` async repair jobs.
- The direct path calls `ensureAssetFaceMaterialization(...)`, which already handles provider invocation and persistence.

This is the strongest live precedent for recurring profile headshots. One uploaded headshot does not need to go through the full async worker by default.

### The async matcher is still project/consent centric

Verified in:

- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-fanout-continuations.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `supabase/migrations/20260403120000_029_complete_bounded_matching_fanout.sql`

Current behavior:

- Intake and fan-out are built around project photos and current project consent headshots.
- `compare_materialized_pair` expects a headshot source that resolves through project consent linkage.
- `materialized-face-compare.ts` effectively assumes one compare-ready headshot face and uses the first persisted face when the materialization is usable.
- Repair and progress reporting enumerate project photos and current project consent headshots only.

No live matching code references `recurring_profile_consents`, `project_profile_participants`, or profile-side headshot sources.

## Verified exact-face and project matching integration boundary

### Exact face identity is already face-row specific

Verified in:

- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260414110000_047_manual_asset_faces.sql`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/manual-asset-faces.ts`
- `src/lib/matching/asset-preview-linking.ts`

Current behavior:

- Exact face identity is `asset_face_materialization_faces.id`.
- That identity already covers both detector faces and manually created faces through `face_source`.
- `asset_face_consent_links.asset_face_id` is the primary key, so one exact face has at most one current assignee.
- `asset_face_consent_links` also has unique `(tenant_id, project_id, asset_id, consent_id)`, so one consent can only occupy one face per asset.
- Zero-face fallback is a separate model in `asset_consent_manual_photo_fallbacks`; it is not the same thing as an exact face.

Recurring-profile matching must fit into this exact-face model. It should never redefine the identity of a detected face away from `asset_face_materialization_faces.id`.

### Canonical ownership remains exact-face specific with manual-over-auto precedence

Verified in:

- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`

Current behavior:

- Manual link writes go through `manualLinkPhotoToConsent(...)`.
- Auto canonicalization goes through `reconcilePhotoFaceCanonicalStateForAsset(...)`.
- Manual links replace auto links and block auto reassignment on that face.
- Manual unlink writes suppressions so auto matching does not immediately recreate the same pair.
- Hidden and blocked faces remove current exact links and exclude those faces from later auto reconciliation.
- Manual faces reuse the same preview, hide, block, and linking flows as detector faces.

Recurring-profile matching must later supply candidate evidence into this same face-level ownership model. It must not weaken manual-over-auto precedence or introduce a second canonical owner for the same exact face.

### Hidden, blocked, manual-face, and zero-face behavior are separate invariants

Verified in:

- `src/lib/matching/photo-face-linking.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/manual-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`

Current behavior:

- Hidden faces are auditable face-level exclusions in `asset_face_hidden_states`.
- Blocked faces are separate auditable face-level states in `asset_face_block_states` for `no_consent`.
- Manual faces are stored as normal face rows with `face_source = 'manual'`.
- Auto canonicalization intentionally ignores non-detector faces, hidden faces, and blocked faces.
- Zero-face fallback remains a distinct whole-asset path and is not part of exact-face overlays.

Recurring-profile matching should later behave as another candidate source for eligible exact faces. It should not collapse hidden, blocked, manual-face, and zero-face flows into a new profile-specific variant.

### Current match-source identity is effectively "current project consent headshot"

Verified in:

- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260410113000_046_asset_consent_face_compare_scores.sql`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/auto-match-jobs.ts`

Current behavior:

- Compare rows are stored in `asset_consent_face_compares`.
- Compare score rows are stored in `asset_consent_face_compare_scores`.
- Both are foreign-keyed to `public.consents(id, tenant_id, project_id)`.
- Versioned compare identity and dedupe are based on:
  - `consent_id`
  - `asset_id`
  - `headshot_materialization_id`
  - `asset_materialization_id`
  - `compare_version`
- Preview candidate reads and auto canonicalization both revalidate compares against the current headshot materialization for that consent.

This means the live match-source identity is not generic. It is a project consent plus that consent's current headshot materialization.

### Current asset preview and review UX is also consent-centric

Verified in:

- `src/lib/matching/asset-preview-linking.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`

Current behavior:

- The lightbox is asset-centric and exact-face-centric.
- It renders overlays for linked, unlinked, hidden, and blocked faces.
- Selecting a face loads ranked candidates for that exact face.
- Candidate rows are built from active project `consents`.
- Manual writes still post to `/api/projects/[projectId]/consents/[consentId]/assets/links`.
- Current detail panels, "change person" trays, and go-to links all target project consents.

This matters for Feature 056: a recurring-profile headshot can later become a candidate source, but it cannot later appear as a first-class assignee in this UI unless project-side assignee identity is widened beyond `consents`.

### Current queue, repair, and progress reporting are consent-headshot based

Verified in:

- `src/lib/matching/auto-match-reconcile.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-fanout-continuations.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/app/api/internal/matching/worker/route.ts`
- `src/app/api/internal/matching/reconcile/route.ts`
- `src/app/api/internal/matching/repair/route.ts`

Current behavior:

- Reconcile scans recent photos, opted-in project consents, and recently uploaded consent headshots.
- Fan-out continuation paging enumerates uploaded photos and current project consent headshots.
- Repair replays photos and current project consent headshots only.
- `reconcile_project` still exists as a job type, but the current materialized worker path treats it as a no-op.
- Project progress RPCs are built around photo and current-consent-headshot completeness.

So the current robust queue architecture is reusable, but recurring-profile sources are not yet part of its source enumeration boundary.

## Current schema/routes/components/helpers involved

### Schema and RPCs

- `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260327150000_025_matching_pipeline_robustness.sql`
- `supabase/migrations/20260403120000_029_complete_bounded_matching_fanout.sql`
- `supabase/migrations/20260414170000_050_recurring_profile_directory_foundation.sql`
- `supabase/migrations/20260414193000_051_baseline_recurring_consent_request_foundation.sql`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`

### Current headshot and consent code

- `src/app/api/public/invites/[token]/headshot/route.ts`
- `src/app/api/public/invites/[token]/headshot/[assetId]/finalize/route.ts`
- `src/components/public/public-consent-form.tsx`
- `src/lib/consent/submit-consent.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`

### Materialization and matching code

- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-fanout-continuations.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/app/api/internal/matching/repair/route.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/manual-asset-faces.ts`
- `src/lib/matching/providers/compreface.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/lib/matching/auto-match-reconcile.ts`
- `src/app/api/internal/matching/worker/route.ts`
- `src/app/api/internal/matching/reconcile/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/manual-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`

### Current profile/project UI and services

- `src/app/(protected)/profiles/page.tsx`
- `src/lib/profiles/profile-directory-service.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/lib/projects/project-participants-service.ts`
- `src/components/projects/project-participants-panel.tsx`

### i18n

- `messages/en.json`
- `messages/nl.json`

There are existing strings for public invite headshot upload and project consent headshot replacement, but no recurring-profile headshot or matching-readiness strings yet.

## Options considered

### Option A: Reuse current consent-headshot model directly

Example shape:

- link recurring profile headshots through `asset_consent_links`
- try to treat recurring consent rows as if they were current project consents

Why not recommended:

- The current matcher, compare code, repair, and progress queries are explicitly project-consent based.
- Recurring profile headshots are a reusable person-level source, not a one-off project consent attachment.
- Forcing profile headshots into the consent-headshot model would blur ownership and make later profile-participant matching harder to reason about.

### Option B: Send every recurring profile headshot through the async worker first

Why not recommended:

- For one uploaded headshot, the repo already has a direct request-time materialization pattern that is simpler and faster.
- The async worker is currently best suited to project-scale fan-out and repair, not single-headshot intake UX.
- This would increase latency and make upload readiness less deterministic without reusing the best existing path.

### Option C: Infer matching authorization from recurring consent structured fields only

Why not recommended:

- Live recurring consents currently store `structured_fields_snapshot`, but no normalized `face_match_opt_in` column.
- Reading template-specific structured data at every readiness check would be brittle and hard to audit.
- Matching authorization should be an explicit server-side field, not a loosely interpreted snapshot blob.

### Option D: Add a small profile-side headshot foundation beside the existing consent model

Example shape:

- keep `assets`, `asset_face_materializations`, and `asset_face_materialization_faces`
- add profile-side headshot linkage and canonical-face selection metadata
- derive project matching from that profile-side readiness later

Why recommended:

- It preserves the existing project consent headshot pipeline.
- It reuses the detector/materialization storage that already exists.
- It creates a clean recurring-profile source of truth without redesigning compare fan-out now.

### Option E: Make recurring profiles a direct second assignee identity in Feature 056

Why not recommended:

- The current exact-face link, suppression, fallback, compare, compare-score, and candidate tables are foreign-keyed to `public.consents`.
- The preview lightbox and manual write routes also assume `consentId`.
- Forcing recurring profiles directly into those tables would immediately widen project-side assignee identity, which is larger than this feature boundary.

Feature 056 should choose a profile-headshot model that is compatible with that later widening, but it should not perform it.

## Recommended bounded feature scope

The smallest coherent slice is:

1. Support one current recurring profile headshot at a time.
2. Allow upload/replace only when a valid recurring matching authorization is active.
3. Materialize that one headshot immediately using the existing direct single-asset pattern.
4. Persist all detected faces from the materialization result.
5. Auto-select one canonical face only when the result is clearly safe.
6. Surface explicit not-ready states when no safe canonical face can be chosen.
7. Mark the profile as matching-ready only when authorization, headshot presence, materialization, and canonical-face selection all line up.
8. Define, but do not redesign, the later project-trigger seam into the existing async matcher.

This feature should not try to make recurring profile headshots fully participate in project compare fan-out in the same slice. It should establish the profile-side matching source and readiness model that later matching integration can consume.

## Recommended materialization strategy

### Default: direct request-triggered materialization for one headshot

Recommended behavior after upload finalization or replacement:

1. Server validates tenant membership and recurring-profile ownership.
2. Server validates active recurring matching authorization.
3. Server links the uploaded headshot as the current profile headshot.
4. Server calls `ensureAssetFaceMaterialization(...)` directly for that asset.
5. Server reads persisted detector faces and computes canonical-face selection/readiness.
6. If direct materialization fails unexpectedly, the request should persist the headshot link but return a non-ready processing state and enqueue a `materialize_asset_faces` fallback job.

Why this fits the live repo:

- It mirrors the `manual-link-state` direct materialization pattern.
- It gives immediate readiness feedback for one headshot.
- It keeps the large async worker focused on project fan-out and repair.

### Async worker use should remain secondary here

Recommended worker role for this feature:

- fallback repair if the direct materialization path cannot complete
- later project matching fan-out after a profile becomes matching-ready

The async worker should not be the primary way to decide whether a single recurring profile headshot is usable.

## Recommended authorization model

### Use recurring baseline consent as the authorization anchor

Recommended bounded rule:

- a recurring profile may only carry a matching headshot when it has an active baseline recurring consent with explicit `face_match_opt_in = true`

Why this is the best fit:

- Baseline consent is the reusable tenant-level consent context introduced by Features 049-055.
- A reusable profile headshot source should not depend on per-project consent state.
- This keeps profile-side matching authorization stable across projects while preserving project-specific consent as a separate concern.

### Add an explicit normalized recurring-consent opt-in field

Live gap:

- `recurring_profile_consents` currently has no normalized `face_match_opt_in` column.

Recommended additive direction:

- extend recurring baseline consent capture so the signed recurring consent stores an explicit normalized `face_match_opt_in` boolean alongside the immutable snapshot
- do not infer readiness from free-form structured snapshot reads at runtime

Profiles without an active baseline recurring consent that explicitly authorizes matching should remain headshot-ineligible and not-ready.

## Recommended data model

### Keep one current profile headshot in the first slice

Recommended first-slice model:

- add a profile-side headshot link model rather than reusing `asset_consent_links`
- keep one current headshot per recurring profile
- preserve replacement history additively instead of overwriting raw asset history

Recommended shape to evaluate in plan phase:

- `recurring_profile_headshots`
  - `id`
  - `tenant_id`
  - `profile_id`
  - `asset_id`
  - `selection_face_id` nullable, referencing `asset_face_materialization_faces.id`
  - `selection_status` such as `pending_materialization`, `auto_selected`, `manual_selected`, `needs_face_selection`, `no_face`, `unusable`
  - `selection_reason` nullable, for explicit UI states
  - `superseded_at` nullable
  - `created_at`
  - `created_by`
- unique current row per `(tenant_id, profile_id)` where `superseded_at is null`

Why this is preferred over putting everything on `recurring_profiles`:

- replacement history stays explicit
- selection metadata lives with the selected source asset
- the model stays additive and does not overload the person directory row

### Reuse existing materialization tables

Recommended:

- continue using `asset_face_materializations`
- continue using `asset_face_materialization_faces`
- do not create a profile-specific face embedding table

The live materialization schema already stores the detector output needed for profile headshots.

### Profile matching readiness should be derived from authorization + current headshot state

Recommended readiness should be computed from:

- active baseline recurring consent with explicit `face_match_opt_in = true`
- one current profile headshot link
- one current materialization for that asset
- one selected canonical face
- selected face marked safe for compare under the profile-headshot rules

This can be exposed as a computed service-level state first. A denormalized cached field on `recurring_profiles` is optional later, not required for the first slice.

### Keep canonical selected-face metadata outside raw materialization truth

Recommended:

- preserve all detected faces in `asset_face_materialization_faces`
- store the profile's selected canonical face separately on the profile-headshot linkage row
- treat only that selected face as the profile's future matching source

This is important because raw detector truth and profile matching truth are not the same thing for multi-face headshots.

## Recommended canonical-face selection model

### Principle

Recurring profile headshots are intended to depict one person, but real uploads can contain:

- one clear face
- a clear main face plus a small background face
- multiple similarly plausible faces
- no face
- low-quality or unusable detections

The system should auto-select only when the foreground subject clearly wins. It should not guess when two or more faces are similarly plausible.

### Recommended bounded rule

For each detected face, compute a prominence score using:

- relative face size from `face_box`
- centrality within the image
- detection confidence from `detection_probability`

Recommended auto-selection behavior:

- zero faces: status `no_face`
- one face:
  - auto-select if it passes minimum confidence/quality thresholds
  - otherwise `unusable`
- multiple faces:
  - rank by prominence score
  - auto-select only when the top face clearly beats the next candidate
  - otherwise `needs_face_selection`

Recommended practical bias:

- face size should be the strongest factor
- centrality and confidence should break ties and reduce edge/background false picks

This satisfies the important portrait case:

- if a clear employee portrait includes a small background face, the large foreground face should win automatically
- if two faces are similar in size and position, the result should be ambiguous rather than guessed

### Relation to the existing materialization flag

The current asset-level headshot rule marks multi-face headshots as `usable_for_compare = false`.

Recommendation:

- keep raw materialization output as detector truth
- add profile-headshot selection/readiness on top of it
- do not rely on the raw headshot `usable_for_compare` flag alone for recurring profile readiness

Reason:

- the raw materialization flag currently answers "was this headshot safely single-face by the old rule"
- Feature 056 needs a stronger answer: "do we now have one explicit canonical source face for this profile"

## How recurring-profile headshots should later fit into project matching

### Preserve the existing exact-face ownership model

Later recurring-profile integration should preserve all of these live invariants:

- exact face identity remains `asset_face_materialization_faces.id`
- one current assignee per exact face remains enforced by `asset_face_consent_links.asset_face_id`
- one assignee per consent per asset remains enforced by `(tenant_id, project_id, asset_id, consent_id)`
- manual-over-auto precedence remains unchanged
- hidden, blocked, and manual-face behavior remains face-specific
- zero-face fallback remains a separate whole-asset path

Recurring-profile headshots should later act as another source of scored evidence for an exact face. They should not become a new kind of face owner.

### Do not assign exact faces directly to `recurring_profiles`

Live constraint:

- all canonical current-link and candidate tables are currently foreign-keyed to `public.consents`

Recommended future direction:

- keep recurring profile headshots as reusable person-level source material
- later map that source material into a project-local assignee identity before it reaches canonical face ownership

This is the smallest additive direction because it keeps profile-side headshot readiness independent while acknowledging that project-side assignee identity is still consent-scoped today.

### Recommended future fit: derive project-local match sources from ready profiles

Recommended later model:

- a matching-ready recurring profile should later resolve into a project-local match source only when the project has an eligible participant/consent context for that profile
- the source side uses:
  - `profile_id`
  - current profile headshot asset
  - current headshot materialization
  - selected canonical face id
- the project-side candidate/assignment side still needs a project-local assignee identity compatible with exact-face writes

The likely later project-side assignee is a signed project-specific recurring consent context, not the bare profile directory row. That preserves the existing "no consent means no assignment" rule from Feature 048.

### Why this should not become a direct second compare identity in Feature 056

Current compare identity is hard-wired to:

- `asset_consent_face_compares.consent_id`
- `asset_consent_face_compare_scores.consent_id`
- `asset_consent_match_candidates.consent_id`

Adding a direct profile-based compare identity now would force an immediate widening of:

- compare persistence
- candidate persistence
- preview candidate payloads
- exact-face link writes
- repair and progress queries

That is too large for Feature 056. The bounded choice is to keep the profile-side source model clean now, then widen project-side assignee identity in a later matching integration slice.

### Future queue integration should reuse the current queue architecture, not replace it

Recommended later behavior:

- keep the existing lease-safe job queue
- keep bounded fan-out continuations
- keep `materialize_asset_faces`
- keep versioned compare dedupe
- keep repair/replay semantics

What changes later:

- project source enumeration must gain a profile-backed source path
- repair and progress reads must include that new source path

The existing architecture is good enough. The missing piece is source enumeration, not queue redesign.

### Recommended future enqueue seam

Current reality:

- `consent_headshot_ready` is tied to `consent_id`
- `reconcile_project` exists but is currently a no-op in the materialized worker path

Recommended later seam:

- when a matching-ready recurring profile changes project matching inputs, enqueue one `reconcile_project` job per affected project
- extend the later project reconciliation path to enumerate both current project consent headshots and profile-backed eligible sources

Why this is still the best future seam:

- one ready profile can affect many projects
- project participation changes are naturally project-scoped
- the queue already supports idempotent per-project dedupe and replay

Important caveat:

- Feature 056 should document this seam, but it should not claim that enqueuing `reconcile_project` today would produce recurring-profile matches, because the live worker does not do that yet

### Asset preview and candidate trays should later treat profile-backed matches as another candidate source for an exact face

Later UI direction:

- the lightbox stays asset-centric
- one exact face is selected
- the candidate tray shows ranked assignee candidates for that face
- recurring-profile-derived candidates should appear in that tray alongside other eligible project candidates

To preserve current UX foundations, later candidate rows should still support:

- auto-vs-manual distinction on the winning exact link
- remove/change link actions
- hidden/block actions
- manual face creation flows
- move warnings when a candidate is already linked elsewhere in the asset

What should be additive later:

- candidate metadata indicating whether the assignee is one-off project consent backed or profile-backed
- non-assignable/no-consent states when a known profile exists but lacks the project consent context needed for canonical assignment

Feature 056 does not need to build that UI, but it must not choose a profile-headshot model that assumes the lightbox will bypass exact-face writes.

## Recommended matching-readiness model

Recommended recurring profile matching states to expose in services/UI:

- `blocked_no_opt_in`
- `missing_headshot`
- `materializing`
- `no_face_detected`
- `needs_face_selection`
- `unusable_headshot`
- `ready`

Recommended `ready` gate:

- active baseline recurring consent with `face_match_opt_in = true`
- current profile headshot exists
- current headshot asset is uploaded and not archived
- materialization exists for the current asset
- canonical selected face exists
- selected face passes compare-safety thresholds

Important implication:

- uploading a profile headshot does not make the profile matching-ready by itself
- a recurring profile is only matching-ready when the headshot has become a usable matching source

## Should multiple profile headshots be supported now?

Recommended answer:

- No. Support one current headshot only in Feature 056.

Why:

- The product value is in obtaining one reliable matching source quickly.
- The current matcher and compare model already assume a single source headshot face.
- Multiple profile headshots introduce gallery management, source precedence, and recompare rules that are not needed for the first slice.

Recommended defer:

- historical list/detail may exist in the linking table
- end-user multi-headshot management should wait

## Recommended replacement behavior

When an admin replaces the current recurring profile headshot:

1. Validate tenant scoping, profile existence, and active baseline matching opt-in.
2. Validate the replacement asset is an uploaded `headshot`.
3. Supersede the old current profile-headshot link and make the new asset current.
4. Clear any canonical-face selection tied to the old current row.
5. Run direct materialization on the new current asset.
6. Recompute readiness from the new materialization result.
7. Archive or leave the old asset per the existing asset-link retention rules if it is no longer referenced elsewhere.

Important state rule:

- old matching-ready state must not survive replacement
- readiness must be recomputed from the new asset every time

Future matching implication:

- replacing a profile headshot should later invalidate auto-derived compare evidence and auto links that depended on the old selected face
- manual exact-face links should remain authoritative
- if later profile-specific suppressions are introduced, they should follow the same "clear source-specific stale state, preserve explicit manual decisions" principle as current consent-headshot replacement

The later project response should be project re-evaluation, not a destructive reset of all manual review work.

## Recommended project-trigger behavior

### Trigger conditions

The project-side enqueue seam should activate when:

- a recurring profile transitions from not-ready to `ready`
- a `ready` recurring profile is added as a participant to a project
- a previously `ready` profile becomes not-ready because the headshot was replaced, removed, or the baseline opt-in was revoked

### Recommended trigger type

Use `reconcile_project` as the preferred future project-scoped intake seam for affected projects.

Why:

- one matching-ready profile can affect multiple projects at once
- project participation changes are project-scoped rather than asset-scoped
- it avoids pretending a profile headshot can already be expressed as `consent_headshot_ready`
- It is naturally idempotent for retries and duplicate clicks.

### Important boundary

Feature 056 should define this trigger seam, but not claim that the current worker already compares recurring profile headshots.

Current reality:

- the live worker enumerates project photos and current project consent headshots only
- the live worker currently no-ops `reconcile_project` in the materialized intake path

Recommended follow-on direction:

- once a later slice teaches project reconciliation/fan-out how to enumerate ready recurring profile headshots for project participants, the trigger above becomes the correct project-level replay hook

This keeps Feature 056 focused on profile-side readiness while still choosing the correct future integration point.

## Recommended UI surfaces

### First-slice UI

Recommended initial surfaces:

- `/profiles`
  - show a matching-readiness badge/state per profile
  - show whether matching is blocked by missing opt-in, missing headshot, ambiguity, or unusable materialization
- profile detail / inline detail panel
  - upload or replace current headshot
  - show current processing/readiness state
  - show limited explanatory helper text for ambiguous or unusable outcomes
- `/projects/[projectId]`
  - later-ready signal can start as a bounded participant-level indicator for known profiles, such as "match source ready" vs "needs headshot" vs "ambiguous"
  - this is useful even before the lightbox consumes profile-backed candidates

### Not required in this cycle

- project page matching result UI
- project participant face-selection tooling
- project asset-to-profile linking UX

### i18n

All new user-facing strings should be added through the existing i18n framework in both:

- `messages/en.json`
- `messages/nl.json`

New strings will likely include:

- headshot upload/replace actions for recurring profiles
- matching authorization blocked messaging
- readiness badges and helper text
- ambiguous/no-face/unusable statuses

## Security and reliability considerations

- All profile lookup, upload finalization, replacement, and readiness reads must derive tenant scope server-side from the authenticated session.
- Never accept `tenant_id` from the client.
- Never expose service-role credentials to the client.
- Authorization for recurring profile matching should come from signed recurring consent state, not from a mutable client toggle.
- Headshot replace and current-link writes should be idempotent where practical, using current-row uniqueness and safe upsert/supersede patterns.
- Duplicate upload or replace clicks must not create multiple current headshots.
- Replacement should not delete old data before the new current row is persisted.
- Direct materialization failures should degrade to a processing/not-ready state plus async repair, not to partial silent success.
- Headshot readiness should always be recomputed from current linked state to avoid stale selected-face references.
- Revoked baseline opt-in must immediately block readiness even if a usable headshot still exists.
- Future project matching integration must not bypass the existing exact-face ownership tables or manual precedence rules.
- Future recurring-profile candidates in preview must remain non-assignable until the project-side assignee identity satisfies the same consent rules as current assignments.

## Edge cases

- Clear portrait with a tiny background face: auto-select the large foreground face when it clearly dominates by size and remains reasonably central/confident.
- Two similarly framed faces: mark `needs_face_selection`; do not guess.
- No face detected: persist materialization result and show `no_face_detected`.
- Low-confidence or poor-quality single detection: mark `unusable_headshot`.
- Duplicate replace clicks: keep one current row and one resulting readiness state.
- Replace while profile participates in active projects: recompute readiness from the new asset and enqueue affected project reconciliations later.
- Baseline matching opt-in revoked after a profile was ready: readiness becomes blocked immediately; downstream project matching should later reconcile from that change.
- Stale materialization row from an old headshot: ignore it by resolving readiness only through the current profile-headshot link and current asset id.
- Direct provider timeout during upload/replace: keep the headshot linked, show processing/not-ready, and enqueue async materialization repair.
- Matching-ready profile participates in a project but has no project-local assignable consent context yet: later scoring may be possible, but canonical exact-face assignment must remain blocked until the project-side assignee identity is valid.
- Later profile-backed candidate appears in lightbox for an exact face that is already manually assigned: candidate may be visible, but manual exact link must continue to win.

## Explicitly deferred work

- redesign of the async matching worker
- widening project-side assignee identity beyond the current consent model
- full recurring-profile participation in compare fan-out
- project face-to-profile linking UX
- matching result review UI
- asset-triggered request generation
- bulk headshot upload
- full multi-headshot gallery management
- automatic background scheduler beyond the existing repair/job patterns
- one-off signer and recurring profile identity merge
- CompreFace provider redesign

## Open decisions for the plan phase

- What exact schema shape is best for current profile headshot linkage: dedicated `recurring_profile_headshots` table only, or that table plus a small denormalized pointer on `recurring_profiles`?
- Should Feature 056 include a minimal manual face-selection action when `needs_face_selection`, or only surface the ambiguous state and require replacement in the first slice?
- What concrete prominence thresholds should separate "clear foreground winner" from ambiguity?
- Should existing recurring baseline consent flows be extended now to normalize `face_match_opt_in`, or is a small migration/backfill strategy needed for already signed baseline consents?
- Should replacement archive the prior asset immediately when no longer referenced, or follow the same delayed retention behavior used elsewhere for headshots?
- Should the first profile list surface only a badge, or also show the specific blocking reason inline?
- What later project-side assignee identity should consume a matching-ready profile headshot: direct widening beyond `consents`, or a smaller project-local resolver around signed recurring project consent rows?
- Should the first project page already show participant-level match-source readiness badges for known profiles, or leave that until the matching integration slice?
