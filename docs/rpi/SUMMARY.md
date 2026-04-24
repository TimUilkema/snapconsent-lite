# SnapConsent Project Summary

This document is long-lived project context for AI-assisted work in this repository. It is intentionally broader than a README and is meant to reduce the need to re-read every historical RPI folder before starting a new task.

Source-of-truth order for this summary:

1. Live code and current schema in `src/` and `supabase/migrations/`
2. Newer RPI docs in `docs/rpi/`
3. Older RPI docs in `docs/rpi/`

Where older docs and live code differ, this summary follows the live repository state as of 2026-04-24.

## 1. Project overview

SnapConsent is a multi-tenant web application for collecting, storing, reviewing, and operationalizing media-use consent. The product sits at the intersection of consent management and media review. It is not just a form-signing app and not just a photo organizer. The core product value comes from tying auditable consent records to actual project media, then giving staff a controlled way to decide which people are represented in which assets.

The main internal users are tenant staff such as owners, admins, reviewers, and photographers. Owners and admins manage tenants, members, templates, recurring profiles, and project staffing. Reviewers handle review and export workflows. Photographers handle capture inside assigned project workspaces. The public users are people who receive a tokenized link to sign, revoke, or accept an organization invite. Public users never operate directly on tenant-scoped data; they only act through tightly bounded token flows.

The product solves four related business problems:

- It provides auditable, immutable consent capture with later revocation instead of destructive deletion.
- It lets projects gather consent from one-off participants and from known recurring people without forcing both workflows into the same data model.
- It keeps project media private while still making upload, preview, thumbnailing, playback, and export practical.
- It helps staff connect media to consenting people through exact-face review, whole-asset review, and matching-driven operator workflows.

Consent, media, and project workflows are tightly linked. A project is now the umbrella organization-facing unit, and `project_workspaces` are the photographer-scoped operational units inside it. Staff create invites, collect one-off consents, add recurring participants, upload photos or videos, and review the resulting media inside a selected workspace. One-off consent and recurring consent are both upstream authorization layers. Uploaded media and generated face materializations are the downstream review layer. Matching and manual review connect the two.

## 2. Core product and domain model

The current product has four overlapping scopes that matter in almost every feature:

- Tenant scope: the workspace boundary. Most business data belongs here.
- Project scope: the umbrella boundary for one campaign, event, or shoot.
- Project-workspace scope: the isolated capture, matching, review, and export boundary inside a project.
- Public-token scope: narrow public access to exactly one invite, request, or revoke operation.

### Tenant-scoped foundation

`tenants` and `memberships` define the workspace boundary. Accounts can now belong to multiple tenants, and active-tenant resolution is server-side. Current code centralizes recovery in `src/lib/tenant/resolve-tenant.ts`, which validates the `sc_active_tenant` cookie against current memberships, auto-resolves the sole membership, blocks bootstrap while a pending organization-invite cookie is present, and only then falls back to `ensure_tenant_for_current_user()`. Future work should reuse that path rather than inventing new membership lookups.

Consent templates are now effectively tenant-managed. The current live model in `src/lib/templates/template-service.ts` supports draft, published, and archived versions, structured fields, and form layout definitions. The type layer still recognizes `app` versus `tenant` scope, but current project usage and visible-template listing are tenant-centric, and the seeded app-template era has been removed from the live schema.

Recurring profiles are also tenant-scoped. They represent known people that the tenant may work with repeatedly across projects. A recurring profile is not the same thing as a one-off project subject, and the product intentionally keeps those concepts separate.

`memberships` now support four live roles: `owner`, `admin`, `reviewer`, and `photographer`. Owners and admins can manage tenant members through `tenant_membership_invites`, and organization join acceptance uses the public `GET /join/[token]` plus authenticated accept route. Organization invite delivery now reuses the outbound email foundation instead of a route-local SMTP path.

### Project and workspace operational model

`projects` are now the umbrella organization-facing unit. They hold project metadata, default template choices, staffing, and one or more `project_workspaces`.

`project_workspaces` are the operational capture and review units inside a project. A workspace can have:

- one-off subject invites
- one-off subjects and signed consents
- project assets such as photos and videos
- project participants that point at recurring profiles
- workspace-scoped recurring consent requests and signed recurring consents
- workspace-scoped matching, review, assignment, and export state

This boundary matters. If a project has multiple photographer workspaces, each workspace keeps its own consent intake, asset pool, matching fanout, review queue, and export payload. Owners, admins, and reviewers can inspect project workspaces across the umbrella project. Photographers are constrained to their assigned workspace rows.

`subject_invites` are workspace-scoped invite records for one-off signers. They are created by staff, tied to a specific project workspace and consent template, and exposed publicly only through a tokenized invite path. The public invite flow is `GET /i/[token]` plus the submission route behind it. Invite rows are not public by themselves; only the hashed-token RPC path is public.

`subjects` are one-off identity rows scoped by tenant, project, and workspace. A subject is typically created or reused as part of public invite signing. The one-off upgrade path reuses the same `subjects` row inside the same workspace rather than rebinding the consent to a different person.

`consents` are project-workspace-scoped, immutable one-off consent records. Each stores the text and version that were actually signed, plus current revocation state, `face_match_opt_in`, and current `structured_fields_snapshot`. Older docs often describe consent as simple text plus version. The live app now stores a richer template snapshot, including structured field values at signing time.

One-off consent revocation uses `revoke_tokens` and `consent_events`. Revocation changes future processing but does not delete the signed consent record or erase history.

One-off consent now also has an explicit upgrade path. `project_consent_upgrade_requests` tracks pending upgrade requests bound to the same `subjects` row and workspace, and a newer signed one-off consent can supersede the prior current consent through `superseded_at` and `superseded_by_consent_id`. Old signed rows remain immutable history, but current one-off reads and current one-off assignment state follow the governing unsuperseded consent. Public one-off upgrade UI now knows whether a reusable current headshot exists and only requires a fresh upload when no reusable headshot can be carried forward.

### Recurring profile and recurring consent model

`recurring_profile_types` and `recurring_profiles` are tenant-scoped directory entities. They support profile classification, profile archiving, and a reusable pool of known people.

`recurring_profile_consent_requests` and `recurring_profile_consents` are the recurring-consent backbone. The current live schema supports two consent kinds:

- `baseline`: tenant/profile scoped
- `project`: tenant/project/workspace/profile scoped

This distinction matters. Baseline recurring consent is the standing authorization for the tenant to work with a recurring profile at a general level, including whether face matching may be used. Project recurring consent is the workspace-specific authorization that makes a recurring profile eligible for assignment inside one project workspace. A profile may have baseline consent without current project consent, and that is an expected state.

`project_profile_participants` are the bridge that adds recurring profiles into a specific project workspace. They do not themselves mean the person has granted project consent. They are the workspace-local participation record that later recurring consent, matching readiness, and assignment logic build on.

Recurring project replacement requests can now coexist with an active current project consent. Creating a replacement request does not demote the current signed project consent; the old row remains current until a newer project consent successfully signs and supersedes it.

Recurring public flows use separate public routes from one-off invites:

- `GET /rp/[token]`: public recurring consent request
- `GET /rr/[token]`: public recurring consent revoke flow

The recurring public flow reuses the same core principles as one-off public consent: server-validated token access, immutable signed records, bounded revoke handling, and no client authority over tenant, project, or workspace identity.

Project-media consent now also has a derived scope-state layer. `project_consent_scope_signed_projections` stores immutable per-scope signed projections for one-off project-workspace consent and recurring project-workspace consent, and `project_consent_scope_effective_states` derives the governing per-scope operational state by stable owner boundary plus template family. The effective vocabulary is `granted`, `not_granted`, `revoked`, and `not_collected`, where `not_collected` means the governing signed version did not include that scope.

### Media and asset model

`assets` are project-workspace-scoped media records. The current live app supports three asset types:

- `photo`
- `headshot`
- `video`

Project photos and videos live in the selected project workspace asset space. One-off consent headshots also reuse the `assets` table, but they are marked `asset_type = 'headshot'` and are governed by separate consent and retention rules. Headshot assets are not just generic project uploads.

`asset_consent_links` still exists and still matters, but not as the modern exact-face ownership table. In current live behavior it is most relevant for headshot attachment and older asset-level link history. Future work should not mistake it for the canonical exact-face assignment model.

Recurring profile headshots are modeled separately from `assets`. They use:

- `recurring_profile_headshots`
- `recurring_profile_headshot_materializations`
- `recurring_profile_headshot_materialization_faces`
- `recurring_profile_headshot_repair_jobs`

This separation matters because recurring headshots are tenant/profile infrastructure, not project assets. One-off consent headshots are project-workspace-linked; recurring headshots are reusable profile-linked matching inputs.

For recurring headshots, any upload with more than one detected face now requires manual canonical-face selection. The server no longer auto-selects a dominant face for multi-face recurring headshots.

### Exact-face materialization and ownership model

For project photos inside one workspace, the live matching system is now face-centric. Current photos can have materialization rows in:

- `asset_face_materializations`
- `asset_face_materialization_faces`

These represent SnapConsent-owned face materialization state, including current detected faces and manually created faces. The exact-face owner model does not assign a consent directly to a photo as a single blob. Instead, the product assigns one current assignee to one current face.

The assignee bridge is `project_face_assignees`. It normalizes two identity kinds into one project-workspace-local assignment model:

- `project_consent`
- `project_recurring_consent`

That bridge is the key later-era design move. It lets one-off project consents and workspace-scoped recurring project consents participate in the same exact-face and whole-asset linking flows without collapsing them into the same table.

One-off upgrade completion can retarget the existing one-off assignee row and still-current consent-backed link rows from the prior consent to the new governing consent. That lets exact-face, fallback, and whole-asset behavior keep following the same person without treating an upgrade as a brand-new current owner.

Current exact-face links live in `asset_face_consent_links`. Despite the name, the canonical exact-face model is really "asset face to project face assignee", not "asset to consent". A face can have only one current assignee. That is one of the main modern invariants of the repo.

### Whole-asset linking and fallback model

Exact-face ownership is not the only way to relate a person to an asset. The repo also has two broader asset-level link concepts:

- zero-face photo fallback links for photos where no usable face exists
- whole-asset links for manual assignment at the asset level

Manual zero-face photo fallback is represented by `asset_consent_manual_photo_fallbacks` and related suppression rows. This is specifically for photos that are still relevant to a consented person even when there is no usable exact-face target.

Whole-asset links are represented by `asset_assignee_links`. These are manual-only links to `project_face_assignees`, and they now support both photo and video assets. This is especially important for video because the current live product supports video preview and linking, but it does not have a photo-style exact-face ownership pipeline for videos.

### Matching evidence, candidates, suppressions, hidden state, blocked state, and manual faces

The repo has several related but distinct classes of matching state:

- `asset_consent_match_candidates`: likely-match review candidates from earlier pair-level flows
- `asset_consent_match_results`, `asset_consent_match_result_faces`, `asset_consent_face_compares`, `asset_consent_face_compare_scores`: pair-level observability and compare evidence for one-off consent matching
- `asset_project_profile_face_compares`, `asset_project_profile_face_compare_scores`: equivalent compare evidence for recurring-profile-backed matching
- `asset_face_consent_link_suppressions` and `asset_face_assignee_link_suppressions`: rows that prevent specific automatic relinking after manual operator intent
- `asset_face_hidden_states`: operator-hidden faces that should stop driving normal review and assignment workflows
- `asset_face_block_states`: operator-blocked faces that represent "this face has no consent and should count as blocked"
- `face_review_sessions` and `face_review_session_items`: bounded review-session state for consent-centric face review workflows

Manual faces are their own concept. A manual face is not a hidden face or a blocked face. It is a new persisted face row created by an operator when detector output missed someone. Manual faces live inside the same materialization model as detector faces, and they participate in linking and review like exact faces.

### What is tenant-scoped, project-scoped, project-workspace-scoped, and public-token-scoped

The easiest way to reason about scope is this:

- Tenant-scoped: tenants, memberships, tenant membership invites, recurring profiles, recurring profile types, baseline recurring consents and requests, consent templates, and the identity of staff users.
- Project-scoped: projects, project metadata, project staffing, project defaults, and project workspace roster.
- Project-workspace-scoped: subject invites, one-off subjects and consents, project assets, project participants, project recurring consents and requests, exact-face materializations, exact-face links, whole-asset links, matching progress, review state, and export.
- Public-token-scoped: public invite signing, one-off revoke, recurring request signing, recurring revoke, organization-join invites, and public headshot-upload steps. Public flows never receive raw authority over tenant membership, project scoping, or workspace scoping; they are tightly limited to the token's server-validated scope.

## 3. Core invariants and safety rules

The repo has several non-negotiable rules that future work should preserve.

### Tenant scoping is mandatory everywhere

Every domain query is expected to carry tenant scope. Client input must never decide `tenant_id`. The server resolves tenant membership and applies tenant filters explicitly, with RLS and server-side checks acting as backstops rather than optional safeguards.

### Active-tenant choice is validated against memberships

Accounts can now belong to multiple tenants. The active-tenant cookie is only a hint; current server code validates it against current memberships, auto-resolves the sole membership, and routes multi-membership users through explicit active-tenant selection. Pending organization invites also suppress normal bootstrap so invited users do not accidentally create a new owner tenant before joining the intended organization.

### The client is not authoritative

Security-critical logic lives in route handlers, server helpers, RPCs, and database constraints. Client code may gather inputs and show UI state, but it must not decide tenant scope, project authority, consent validity, or matching eligibility.

Related security rules from repo policy still apply everywhere:

- do not expose the Supabase service role key to the client
- use parameterized queries, query-builder filters, or RPC arguments rather than string-built SQL

### Roles and workspace assignments are real access boundaries

`owner` and `admin` are the tenant-wide manager roles. `reviewer` is review-only. `photographer` is capture-only and only within assigned `project_workspaces`. Current RLS and server helpers treat workspace access as a real security boundary, not just a UI filter, so photographers must not see or mutate another workspace's rows.

### Public access is token-scoped and hash-backed

Consent, recurring, and organization-invite tokens are derived server-side, and only token hashes are stored. Public routes exist for exactly bounded actions such as signing, revoking consent, or joining an organization. Public pages do not expose broader tenant, project, or workspace data.

### Writes are expected to be idempotent and retry-safe

The repo uses `idempotency_keys`, deterministic dedupe keys, and upsert-style write patterns throughout create/finalize flows, public consent flows, matching jobs, and recurring request flows. A retry after network loss should not create duplicate durable state. When designing new writes, the first question should be "what happens if this is sent twice?"

### Consent records are immutable history, not mutable preference rows

One-off `consents` and recurring `recurring_profile_consents` are signed historical records. Revocation adds current-state markers and audit rows, but signed records remain. Future processing should stop when consent is revoked, but historical truth is preserved.

Upgrade and replacement flows now also have explicit current-versus-history semantics. Pending replacement requests do not demote the current governing consent. A one-off or recurring project consent becomes historical only after a newer signed consent supersedes it, and future matching eligibility follows that governing consent's revocation and `face_match_opt_in` state.

### Baseline recurring consent and project recurring consent are different boundaries

Baseline recurring consent is tenant/profile level. Project recurring consent is project level. Baseline consent may enable recurring headshots and readiness, but project assignment inside a project depends on current project recurring consent state. Future features should not casually collapse these concepts.

### Exact-face ownership is exclusive and current-state based

In the modern matching model, a current photo face can have only one current assignee. This is the core exact-face ownership rule introduced after the older asset-level matching era. Any feature that tries to create multiple current owners for a single face is fighting the current model.

### Manual operator intent beats automatic matching

Manual exact-face links override auto links. Manual replacements and unlinks create suppressions that stop the worker from silently reintroducing an unwanted automatic assignment. Matching is assistive, not authoritative over staff review.

### Hidden, blocked, and manual-face are different concepts

- Hidden means "take this face out of normal review and assignment until restored."
- Blocked means "this face represents a person without consent; keep it visibly blocked."
- Manual face means "the operator created a new exact-face region that the detector missed."

Future work should preserve those distinctions. A hidden face is not the same as a blocked face, and neither is the same as a manually created face.

### Whole-asset links are not the same as exact-face links

Whole-asset links are manual-only and represent asset-level assignment. Exact-face links represent ownership of a specific face. They solve different problems. The current system prevents a whole-asset link from coexisting with an exact-face link for the same assignee on the same asset when that would be contradictory, and auto exact-face upserts can clear conflicting whole-asset rows.

### Asset privacy is the default

Project assets, headshots, and derived images are stored privately. The app uses signed URLs for image display, face crops, and video playback. Public buckets and direct unauthenticated media exposure are not part of the design.

### Async pipelines must be replayable and repairable

Matching and derivative generation are intentionally asynchronous. Finalize routes try to enqueue downstream work, but the system assumes enqueue can fail and that reconcile or repair paths must backfill missed work. Photo finalize now uses the correct privileged enqueue boundary for matching work, but derivative workers are still separate from matching workers, so repair and reconcile remain the fallback when queueing is missed. New async features should follow the same pattern instead of assuming the first enqueue always succeeds.

### Video support is layered on existing privacy and review rules

Video is now a first-class asset type for upload, listing, preview, poster generation, playback, and whole-asset linking. It is not yet a face-materialized matching type like photos. Future video features should not assume that the photo exact-face pipeline already exists for video.

## 4. Architecture and implementation style

The stack is fixed by repo policy:

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth, Postgres, Storage, and RLS
- `next-intl` for UI localization

### Server/client split

The repo prefers server-side logic. Pages fetch data server-side where practical, and route handlers own validation, auth, scoping, and write behavior. Client components exist mainly for interaction-heavy surfaces such as uploads, previews, polling, and template editing, but they delegate authoritative actions to server routes.

### Database and Supabase usage

Schema evolution lives in `supabase/migrations`. The product depends on a mix of:

- regular table queries via Supabase clients
- RPCs for public and transactional flows
- RLS plus server-side filtering for tenant isolation
- private storage buckets with signed URL access

The repo uses normal user-scoped server clients for authenticated flows and server-only admin/service-role clients for internal jobs, storage signing, and repair paths. Service role keys stay on the server.

### Create/finalize/upload patterns

Project asset uploads follow a create/finalize pattern. The user prepares or creates an upload, receives a signed storage URL, uploads directly to storage, then calls finalize. Finalize marks the asset uploaded and triggers best-effort downstream work such as derivative generation and matching intake. Batched upload flows build on that same shape rather than replacing it.

One-off consent headshot upload and recurring profile headshot upload use related patterns, but recurring profile headshots live in their own profile-scoped tables and storage bucket.

### Internal worker, reconcile, and repair patterns

The repo prefers internal token-protected endpoints for async maintenance work. Examples include:

- `POST /api/internal/matching/worker`
- `POST /api/internal/matching/reconcile`
- `POST /api/internal/matching/repair`
- `POST /api/internal/assets/worker`
- `POST /api/internal/assets/repair`
- `POST /api/internal/profile-headshots/repair`
- `POST /api/internal/headshots/cleanup`

These flows usually have the same shape:

- durable queued or leaseable work state in Postgres
- a worker that claims batches with a lease
- bounded processing per run
- terminal versus retryable failure handling
- explicit repair or reconcile paths to recover from missed or partial work

### Email and external-link patterns

Outbound email is no longer just ad hoc receipt delivery. The live repo now has a typed outbound email foundation in `src/lib/email/outbound/` with durable job state, registry/renderers, local Inbucket support, and `APP_ORIGIN`-based external links. Current live email kinds are still narrow: `consent_receipt` and `tenant_membership_invite`. Some older recurring delivery paths are still narrower helpers rather than fully migrated job kinds.

### Matching architecture

The current matching system is layered and intentionally bounded.

`src/lib/matching/auto-match-jobs.ts` defines durable matching job types such as `photo_uploaded`, `consent_headshot_ready`, `reconcile_project`, `materialize_asset_faces`, `compare_materialized_pair`, and `compare_recurring_profile_materialized_pair`.

`src/lib/matching/auto-match-worker.ts` processes claimed jobs. The worker materializes faces, schedules bounded compare work, applies canonical exact-face state, and preserves manual-over-auto and suppression invariants.

`src/lib/matching/auto-match-fanout-continuations.ts` is the key completeness layer. It snapshots boundaries and advances through continuations such as:

- `photo_to_headshots`
- `headshot_to_photos`
- `photo_to_recurring_profiles`
- `recurring_profile_to_photos`

That continuation model exists so large projects do not require one giant job while still guaranteeing eventual completeness.

### Derivative generation architecture

The image and video derivative pipeline is similar in style. `asset_image_derivatives` rows are claimed by the asset derivative worker, which renders preview and thumbnail derivatives. Photos are rendered with Sharp. Videos use ffmpeg to extract a poster frame, then Sharp to derive display images. The pipeline is async, leased, retryable, and repairable.

Separate face-crop derivatives exist for face preview and review surfaces.

### Video model

The live product supports:

- project video uploads
- video listing in the normal project assets list
- video poster thumbnails through the derivative worker
- signed video playback URLs
- whole-asset linking for videos

The current design deliberately layers video onto the existing project asset framework instead of introducing a second media subsystem.

### Implementation style

The repository consistently prefers small, additive, reviewable changes. Features usually add one table or bounded state extension, one or two route handlers, a service helper, and minimal UI surface expansion. Large redesigns are explicitly discouraged. New work is expected to fit into existing seams whenever possible instead of replacing major foundations.

## 5. Development workflow and RPI discipline

This repo expects non-trivial work to follow the RPI workflow in `docs/rpi/README.md`:

1. Research
2. Plan
3. Implement

That workflow is not ceremonial. It is how the repo keeps AI-assisted development grounded in live code instead of optimistic assumptions.

### Research

Research exists to establish the actual current system before proposing changes. Good research in this repo should:

- read the required top-level docs first
- inspect the current routes, services, components, tests, and migrations involved
- identify current invariants, not just desired future behavior
- call out retry, auth, scoping, revocation, and worker implications
- explicitly note when older RPI docs appear superseded by newer code

The key discipline is "code first, docs second". RPI research is most useful when it says "the live system currently does X in these files" rather than "we want the system to do Y".

### Plan

Plan docs are meant to be bounded implementation contracts. A good plan in this repo should:

- choose one direction clearly
- say what is in scope and out of scope
- list likely file areas and migrations
- explain security and tenant implications
- explain idempotency, retries, partial failure, and race handling
- describe how testing and verification will work

The best plans in this repo are practical, additive, and small enough to review. They do not wander into future product redesigns unless the live code truly forces that.

### Implement

Implementation is expected to follow the plan closely and only deviate when the live code forces a correction. When implementation discovers drift, the repo expectation is to say so clearly and preserve the stronger source of truth:

- live code and schema first
- newer RPI docs second
- older RPI docs third

Implementation work in this repo should keep changes production-safe, prefer reuse of current services, and preserve database-backed rules.

### How this summary should help future RPI prompts

Future AI work will be better if prompts are shaped around the repo's actual seams.

Good research prompts in this repo usually specify:

- the exact user workflow to inspect
- whether the feature touches one-off consent, recurring baseline consent, project recurring consent, matching, preview/review, upload, template editing, export, or video
- which routes, services, or migrations are likely involved
- the non-negotiable invariants to preserve

Good plan prompts usually specify:

- the chosen boundary and what is explicitly out of scope
- whether schema changes are allowed
- whether async worker, reconcile, or repair behavior must change
- expected handling for retries, duplicate requests, expired tokens, and partial failures

Good implement prompts usually specify:

- that the plan is the contract unless live code forces a correction
- that tenant scoping, server authority, and idempotency must be preserved
- that tests or verification steps should be updated when behavior changes
- that drift between old docs and current code must be reported rather than silently ignored

## 6. Major product and architectural evolution

The easiest way to understand SnapConsent is as a sequence of layered foundations rather than a flat list of disconnected features.

### Era 1: auth, tenants, projects, invites, consent snapshots, and asset upload

Features `001-auth` through `008-asset-thumbnails` established the basic multi-tenant product shell: staff login, protected app areas, projects, one-off subject invites, public signing, revoke flows, immutable consent snapshots, initial consent templates, project asset uploads, headshot opt-in, origin handling, and private-media thumbnail display. This era created the product's base contract: consent is auditable, public flows are token-bounded, and project media is private.

### Era 2: matching moved from manual asset links to queue-driven automation

Features `009-matching-foundation` through `018-compreface-performance-efficiency` introduced the first matching layer. The product started with manual consent-to-photo linking, then added the queue/worker/reconcile backbone, then added a real CompreFace-backed matcher, likely-match review, result observability, face evidence persistence, and worker-level performance tuning. This era established matching as an asynchronous service, not a synchronous request-time action.

### Era 3: materialized face ownership and bounded completeness

Features `019-face-materialization-deduped-embedding-pipeline` through `030-continuation-retry-reliability` are where the architecture matured. The system moved from simpler pair-level match thinking toward SnapConsent-owned face materialization, versioned compare rows, stronger repair behavior, request-size hardening, upload-performance improvements, robust replay and repair, and the bounded continuation model that makes large-project matching eventually complete. This era is the foundation for the current matching architecture.

### Era 4: canonical exact-face ownership and richer operator review

Features `031-one-consent-per-face-precedence-rules` through `048-block-person-assignment-for-faces-without-consent` reshaped the review model. The product stopped being best understood as "consent linked to asset" and became better understood as "project-local assignee linked to exact photo face, with manual precedence". This era added face exclusivity, stronger linking UI, overlays, preview workflows, hidden-face handling, manual face creation, blocked-face handling, derivative reliability, export, language switching, and the modern template editor. The preview and review surfaces became first-class operator tools rather than secondary debugging UI.

### Era 5: recurring profiles and mixed participant identity

Features `049-recurring-profiles-and-consent-management-foundations` through `060-project-unresolved-face-review-queue` added the second major consent model: recurring profiles with baseline recurring consent and project recurring consent. This era created the profile directory, public recurring request and revoke flows, consent history, follow-up actions, mixed one-off plus recurring participant handling inside projects, recurring headshots, recurring matching readiness, and the project-local assignee bridge that lets recurring participants join exact-face assignment without collapsing into one-off consent rows.

### Era 6: whole-asset linking and video support

Features `061-link-consent-to-whole-asset` through `064-whole-asset-linking-for-video-assets` expanded the media model. Whole-asset linking became a real manual workflow beside exact-face linking. Video became a supported project asset type with upload, poster generation, private playback, and whole-asset assignment. Feature `062a-remove-video-duplicate-checking-from-upload-flow` later narrowed the duplicate-handling rules so videos skip normal upload-flow duplicate hashing while photos still use authoritative duplicate hashing.

### Era 7: governing-consent upgrades, tenant RBAC, and workspace isolation

Features `067-consent-scope-state-and-upgrade-requests` through `072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions` added scope-state derivation, governing/current supersedence, the live typed outbound email foundation, tenant RBAC with organization invites and active-tenant selection, upgrade headshot-reuse UX, and the shift from single operational projects to umbrella `projects` plus isolated `project_workspaces`. This is why current code must now be reasoned about in both tenant-role and workspace-scope terms.

### What newer features depend on

The dependency chain matters:

- Recurring matching depends on the materialized matching pipeline, exact-face ownership model, and later the project-face-assignee bridge.
- Whole-asset linking depends on the project-face-assignee identity layer and the modern asset preview surfaces.
- Video preview depends on the derivative worker and signed private URL patterns already used for photos.
- Structured consent templates and live preview depend on the versioned template system, not the original static template assumptions from early docs.
- Project review queueing depends on the current face-level review summary model, including an explicit pending-materialization state for photos that are not ready to be judged as blocked, unresolved, or resolved yet.
- Upgrade UX now depends on governing-consent semantics and reusable-headshot state rather than treating every newer template version as a fresh consent.
- Workspace-scoped capture, matching, review, and export now depend on `project_workspaces` plus workspace-aware permissions and RLS, not just tenant membership.

## 7. Current product capabilities in plain English

Today, a user can belong to multiple tenant workspaces, choose an active tenant when needed, and join an organization through tokenized membership invites. Owners and admins can manage tenant members, pending invites, templates, recurring profiles, and photographer staffing from the protected app.

Inside a project, the live product now distinguishes the umbrella project from one or more isolated `project_workspaces`. Owners and admins can add photographer workspaces. Reviewers can inspect any workspace in the active tenant. Photographers only see projects where they have an assigned workspace, and inside those projects they are constrained to their own workspace.

Inside a selected workspace, staff can create one-off public invite links, choose or inherit consent templates, and collect signed one-off consent records from public participants. Those signed consents preserve the exact text, version, and structured values that were signed. Participants can later revoke through tokenized public links without deleting history.

Staff can also issue one-off upgrade requests to newer published template versions in the same family. Public upgrade signing reuses the same workspace subject, prefills prior values where keys still exist, keeps acceptance unchecked, and can reuse an existing one-off headshot instead of forcing a reupload when a reusable headshot is already linked. The newly signed unsuperseded consent becomes current; older signed rows remain history.

The same tenant can also maintain recurring profiles. A recurring profile can receive a baseline recurring consent request through a public tokenized flow. Once baseline consent exists, the tenant can manage recurring headshots and matching readiness. That profile can also be added to a project workspace as a participant, and the workspace can request project-specific recurring consent from that participant when needed. Pending project replacement requests can coexist with an active current project consent until the newer version signs. This gives the product a mixed model: a project workspace can contain both one-off invite signers and known recurring people.

Project-media consent is now operationalized beyond raw signed snapshots. The app keeps immutable per-scope signed projections and derives current family-scoped scope state as `granted`, `not_granted`, `revoked`, or `not_collected` for one-off subjects and recurring project participants inside a workspace. Those derived states feed preview, filtering, and export without mutating signed history.

For media, staff can upload project photos and videos through the protected app inside the selected workspace. Photos and videos are private assets, and the app renders preview or thumbnail derivatives rather than exposing storage objects directly. Videos also get poster thumbnails and signed playback URLs. One-off consent headshots are collected through the workspace and feed one-off matching. Recurring profile headshots are managed separately and feed recurring matching readiness, and multi-face recurring headshots now require a manual canonical-face choice instead of a server auto-pick.

For review, the app can materialize photo faces, generate candidate matches, auto-assign some exact faces when confidence and consent state allow it, and expose workspace-level review state through the assets surface. Newly finalized photos should normally enqueue matching and materialization work promptly, although repair and reconcile still backfill missed work. Once materialized, operators can use the same workspace assets surface to find needs-review, blocked, and resolved items, then open the preview lightbox to link or unlink exact faces, review likely matches, hide irrelevant faces, block no-consent faces, draw manual face boxes when detection missed someone, and restore prior hidden or blocked states when appropriate.

The app also supports broader asset-level assignment. For photos with no usable exact face, there is manual fallback linking. For photos and videos, operators can create whole-asset links to a project assignee. Whole-asset linking is separate from exact-face ownership and is especially important for video, where the current app supports review and assignment without a photo-style exact-face pipeline.

On the output side, the app can export a bounded ZIP for a single selected workspace. The current export is photo-only and limited to `owner`, `admin`, and `reviewer` users. It includes original project photos plus metadata JSON, consent JSON, face boxes when present, exact-face links, whole-asset links, and fallback links from that workspace. It does not currently export videos.

## 8. RPI feature index

This index lists every current top-level folder in `docs/rpi/` using the live folder names exactly as they exist in the repository.

- `001-auth`: Supabase SSR auth foundation for login, logout, protected routes, and session refresh.
- `002-projects-invites`: Multi-tenant projects, one-off public invite signing, receipt sending, revoke flow, and tenant bootstrap foundation.
- `003-consent-templates`: Original consent-template versioning foundation for signed text snapshots; later product behavior was extended and partly superseded by later template-editor work.
- `004-project-assets`: Initial project asset upload model, asset storage metadata, and asset-to-consent join foundation.
- `005-duplicate-upload-handling`: First duplicate-policy design for project uploads with hash-based duplicate handling and batch-level decisions.
- `006-headshot-consent`: One-off consent headshots, `face_match_opt_in`, headshot retention, and the rule that opt-in requires a valid headshot path.
- `007-origin-url-consistency`: Path-based internal navigation and public-link generation rules, with `APP_ORIGIN` reserved for external email links.
- `008-asset-thumbnails`: Signed thumbnail display for private assets and linked headshot thumbnails in project UI.
- `009-matching-foundation`: First manual consent-to-photo matching foundation that later served as the historical base for richer face-level matching.
- `010-auto-face-matching`: Queue, worker, and reconcile backbone for automated matching without yet redesigning the whole domain.
- `011-real-face-matcher`: Real CompreFace-backed matcher integration behind the existing internal matching architecture.
- `012-manual-review-likely-matches`: Likely-match review band and operator workflow for candidate matches that are not strong enough to auto-apply.
- `013-match-results-observability`: Persistence of scored match results for observability without changing canonical approval rules.
- `014-ui-navigation-refresh`: Major protected-app navigation and information-architecture cleanup without backend redesign.
- `015-headshot-replace-resets-suppressions`: Headshot replacement now clears prior suppressions for that consent so fresh matching can run against project photos.
- `016-compreface-service-fit`: Research-only validation of how CompreFace service modes fit SnapConsent's headshot-to-many-assets product pattern; no plan file exists in this folder.
- `017-face-result-geometry-and-embeddings`: Persistence of per-face geometry and embedding evidence tied to match result rows for later downstream use.
- `018-compreface-performance-efficiency`: Worker-level bounded parallelism and throughput tuning for matching.
- `019-face-materialization-deduped-embedding-pipeline`: SnapConsent-owned face materialization state and deduped, versioned embedding-compare pipeline.
- `020-materialized-headshot-resolution-bug`: Narrow bug fix for broken headshot lookup inside the materialized matching pipeline.
- `021-project-matching-progress-ui`: Project-level matching progress endpoint and UI so operators can monitor async matching work.
- `022-asset-upload-performance`: Currently an empty placeholder directory with no `research.md` or `plan.md`.
- `023-bugfix-requesturi`: Request-URI and large `.in(...)` hardening, plus safer chunked reads for project-scale queries.
- `024-upload-performance-resumability`: Batched prepare/finalize and resumable upload architecture for large photo batches.
- `025-matching-queue-robustness`: Matching replay and backfill hardening so ordering of photo versus headshot arrival does not leave permanent gaps.
- `026-prevent-partial-materialization-orchestration-failures`: Makes materialization orchestration safer to rerun after partial downstream or post-write failures.
- `028-duplicate-upload-detection-regression-after-batched-upload`: Restores authoritative duplicate detection after regressions introduced by the batched upload changes.
- `029-complete-bounded-matching-fanout`: Continuation-based bounded fan-out so matching remains eventually complete in large projects.
- `030-continuation-retry-reliability`: Fixes stalled or terminal continuation behavior after mid-batch enqueue failures.
- `031-one-consent-per-face-precedence-rules`: Canonical exact-face ownership model with one current assignee per face and manual-over-auto precedence.
- `032-face-consent-linking-ui-improvements`: Improves operator workflows on top of exact-face ownership without changing the underlying precedence model.
- `033-asset-face-overlays-and-confidence`: Face overlays, confidence display, and richer face-level review information in asset UI.
- `033-consent-form-template-editor`: Currently an empty placeholder directory with no `research.md` or `plan.md`; the real template-editor work lives later under `039-consent-form-template-editor`.
- `034-materialization-repair-and-overlay-regressions`: Regression fixes around repair behavior and preview overlay correctness after the face-level model changes.
- `035-embedding-compare-response-alignment-bug`: Fixes a wrong-face score alignment bug in multi-face embedding-compare results.
- `036-matchable-photo-pagination`: Pagination for consent review photo lists so large projects do not load every matchable photo at once.
- `037-consent-matching-panel-layout`: Layout and grid improvements for the consent matching panel to make image review less cramped.
- `038-original-image-ingest-and-display-derivatives`: Preserves original uploads while moving toward normalized display-safe image derivatives.
- `039-consent-form-template-editor`: Real template-editor foundation for versioned editable templates, project defaults, publish/archive behavior, and later structured-form evolution.
- `040-asset-display-derivatives-reliability`: Repairs the derivative pipeline and makes the UI reliably use bounded display images instead of full originals.
- `041-ui-language-switch`: Dutch/English UI localization using `next-intl` and a locale cookie on existing URLs.
- `042-structured-consent-template-fields`: Structured template fields, public collection of structured values, and signed structured snapshots in consent records.
- `043-simple-project-export-zip`: First bounded project export ZIP with photo originals, consent JSON, link metadata, and face-box metadata.
- `044-asset-preview-linking-ux-improvements`: Richer preview/lightbox workflows for inspecting and managing links directly from asset preview.
- `045-asset-preview-unlinked-faces-and-hidden-face-suppression`: Shows unlinked faces, adds candidate linking from preview, and introduces hidden-face suppression semantics.
- `046-template-editor-live-preview-and-layout-builder`: Live form preview, preview-only validation, and layout-definition editing for consent templates.
- `047-manual-face-box-creation-in-asset-preview`: Operator-drawn manual face boxes become persisted face rows inside the exact-face model.
- `048-block-person-assignment-for-faces-without-consent`: Distinct blocked-face state for faces that should remain visibly non-assignable because no consent exists.
- `049-recurring-profiles-and-consent-management-foundations`: Introduces the recurring-profiles product area as a separate long-lived consent-management module.
- `050-recurring-profile-directory-foundation`: Real profile directory CRUD, profile types, filtering, search, and archiving foundation.
- `051-baseline-recurring-consent-request-foundation`: Public baseline recurring-consent request, signing, revoke flow, and baseline state derivation.
- `052-baseline-request-management`: Pending baseline-request management, especially cancel and replace flows.
- `053-recurring-consent-history-and-inline-profile-detail`: Plan-alias folder that points to the actual Feature 053 plan used for the inline `/profiles` detail implementation.
- `053-recurring-consent-history-and-profile-detail`: Recurring profile detail and consent-history foundation, implemented as the inline detail experience on `/profiles`.
- `054-baseline-follow-up-actions`: Placeholder delivery attempts, reminders, and new-request follow-up actions for baseline recurring consent.
- `055-project-participants-and-mixed-consent-intake`: Mixed project model where one-off invite signers and recurring profile participants coexist in the same project.
- `056-recurring-profile-headshots-and-matching-materialization-foundation`: Recurring profile headshot upload, materialization, face selection, readiness states, and repair.
- `057-project-matching-integration-for-ready-recurring-profiles`: Adds ready recurring profiles into project matching source enumeration and replay.
- `058-project-local-assignee-bridge-for-profile-backed-matches`: Introduces the project-local assignee bridge that normalizes one-off and recurring project identities into one assignment layer.
- `059-auto-assignment-for-project-scoped-recurring-assignees`: Lets project-scoped recurring assignees participate in canonical exact-face auto-assignment.
- `060-project-unresolved-face-review-queue`: Project-level face review queue with pending-materialization, needs-review, blocked, and resolved asset states, plus filtering and navigation into the preview lightbox.
- `060-tenant-resolution-hardening`: Hardens tenant resolution after auth transitions by centralizing recovery logic in the tenant resolver.
- `061-link-consent-to-whole-asset`: Makes whole-asset manual linking a real project workflow alongside exact-face linking.
- `062-video-upload-foundation`: Adds `video` as a supported project asset type and establishes upload/listing behavior.
- `062a-remove-video-duplicate-checking-from-upload-flow`: Later refinement that removes normal upload-flow duplicate hashing and duplicate-policy enforcement for videos while keeping photo duplicate handling.
- `063-video-asset-preview-playback-and-thumbnails`: Video poster thumbnails, preview integration, and private signed playback URLs.
- `063a-video-poster-thumbnail-performance-investigation`: Research-focused performance investigation into poster/thumbnail generation after video preview support landed.
- `064-whole-asset-linking-for-video-assets`: Extends whole-asset linking to video assets so video review can participate in the same assignee model.
- `065-recurring-profile-multi-face-manual-selection`: Recurring profile headshots with more than one detected face now always require manual canonical-face selection, with warning-specific low-quality states when needed.
- `066-post-finalize-matching-job-enqueue-reliability`: Hardens photo finalize so matching/materialization enqueue uses the correct privileged boundary instead of leaving new photos permanently pending without a job.
- `067-consent-scope-state-and-upgrade-requests`: Adds immutable per-scope signed projections and effective scope-state reads for one-off and recurring project consent, plus one-off upgrade-request and recurring supersedence foundations.
- `068-outbound-email-foundation-with-local-emulation-and-typed-email-jobs`: Live durable typed outbound email-job foundation with provider abstraction, local Inbucket/SMTP development flow, receipt delivery integration, and later reuse by tenant membership invites.
- `069-consent-upgrade-flow-owner-reuse-and-prefill-refinement`: Makes one-off and recurring project upgrade flows owner-bound and prefilled, adds one-off supersedence and carry-forward behavior, and aligns governing-consent reads and matching eligibility with the new current consent.
- `070-tenant-rbac-and-organization-user-management-foundation`: Adds fixed tenant RBAC (`owner`, `admin`, `reviewer`, `photographer`), member-management UI/API, organization invite and join flows, active-tenant selection, and typed invite-email delivery.
- `071-consent-upgrade-flow-headshot-reuse-and-upgrade-ux-fixes`: Fixes upgrade presentation so one-off upgrades can reuse current headshots when available, filters superseded one-off rows out of current-facing reads, and makes recurring replacement flows read as replacements instead of generic requests.
- `072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions`: Reframes `projects` as umbrella containers and adds isolated `project_workspaces`, workspace-scoped capture and review access, photographer-only project visibility, workspace-scoped read models and export, and staffing UI for assigning photographers.
- `archive`: Non-feature holding folder for archived alternatives, currently including `062a-safer-video-duplicate-checking-for-slower-clients` and `062a-simpler-video-duplicate-checking-for-slower-clients`.

## 9. Current mental model for future AI work

The most useful mental model is to treat SnapConsent as four linked subsystems that should not be casually collapsed into each other:

1. Consent acquisition
2. Media ingestion and private delivery
3. Matching and assignment
4. Review and operator control

Those subsystems now cross four scopes: tenant, umbrella project, project workspace, and public token. One-off project-workspace consent, baseline recurring consent, and project recurring consent are separate authorization layers that feed those subsystems in different ways. Umbrella-project behavior and workspace-local behavior should also be kept separate. Photo exact-face ownership, photo whole-asset linking, and video whole-asset linking are separate review outputs that also should not be collapsed.

### Reuse first

Before designing new abstractions, check the current service seams that already encode domain rules:

- `src/lib/tenant/resolve-tenant.ts` for active-tenant recovery and membership resolution
- `src/lib/tenant/active-tenant.ts`, `permissions.ts`, `member-management-service.ts`, and `membership-invites.ts` for active-tenant selection, RBAC, member-management flows, and organization invites
- `src/lib/templates/template-service.ts` for template lifecycle, visibility, validation, and project defaults
- `src/lib/projects/project-workspaces-service.ts` for workspace selection, visibility, and staffing
- `src/lib/projects/project-participants-service.ts` for recurring participants inside project workspaces
- `src/lib/profiles/profile-headshot-service.ts` for recurring headshot lifecycle and matching readiness
- `src/lib/matching/photo-face-linking.ts` for exact-face ownership, suppressions, hidden state, blocked state, and fallback behavior
- `src/lib/matching/asset-preview-linking.ts` for preview payloads, candidate lists, whole-asset surfaces, and review summaries
- `src/lib/matching/project-face-assignees.ts` for the unified project-assignee identity model
- `src/lib/matching/whole-asset-linking.ts` for manual whole-asset semantics
- `src/lib/matching/auto-match-jobs.ts`, `auto-match-worker.ts`, `auto-match-fanout-continuations.ts`, `project-recurring-sources.ts`, and `auto-match-repair.ts` for async matching behavior
- `src/lib/assets/create-asset.ts`, `finalize-asset.ts`, `post-finalize-processing.ts`, and `asset-image-derivative-worker.ts` for media upload and derivative behavior

If a new feature seems to need a fresh abstraction, first check whether one of those files already encodes the boundary.

### What should not be casually redesigned

Future AI work should avoid casual redesign of these foundations:

- active-tenant resolution, tenant scoping, and org-invite bootstrap suppression
- tenant RBAC and organization-invite acceptance rules
- immutable consent plus revocation history
- the distinction between one-off consent and recurring consent
- the distinction between baseline recurring consent and project recurring consent
- umbrella-project versus workspace-scoped operational isolation
- scope-state derivation by stable owner boundary plus template family
- governing-consent versus historical-consent semantics for upgrade flows
- project-local assignee bridging
- exact-face exclusivity with manual-over-auto precedence
- hidden versus blocked versus manual-face semantics
- whole-asset linking as a separate manual workflow
- private signed media URL patterns
- worker plus reconcile plus repair recovery patterns

The repo has already spent many features converging on those rules. Changing them lightly will usually create regressions in newer features that depend on them.

### Where current source-of-truth models live

For future AI prompts, the current source-of-truth is not one document. It is a combination of:

- current migrations in `supabase/migrations/`
- current route handlers in `src/app/api/**/route.ts`
- the service helpers in `src/lib/**`
- newer RPI docs that describe why the current shape exists

If older RPI docs talk about `asset_consent_links` as the canonical approved model for photo matching, that should now be read as historical context, not current truth. The live exact-face model now centers on `project_face_assignees` plus `asset_face_consent_links`, with whole-asset links and fallback links beside it.

If older RPI docs describe `project` as the only operational scope, that should also be read historically. The live product now uses `projects` as umbrella containers and `project_workspaces` as the isolated unit for consent intake, assets, matching, review, and export.

If older RPI docs describe app-global templates as the main template model, that should also be read historically. The live product now behaves like a tenant-managed template system with versioning, structured fields, and layout definition, even though some types still retain `app` scope vocabulary.

### How to layer new features correctly

When adding new work, identify which of these axes the feature really touches:

1. Is this about one-off project-workspace consent, recurring baseline consent, or project recurring consent?
2. Is this about umbrella-project behavior or workspace-local capture/review behavior?
3. Is this about photo exact-face ownership, zero-face photo fallback, or whole-asset assignment?
4. Is this about protected staff workflow, public-token workflow, or internal worker behavior?
5. Is this about photos only, or does video also need explicit treatment?
6. Is this synchronous request logic, or async queue/reconcile/repair logic?

That framing usually reveals the right existing files and invariants immediately.

### How to think about exact-face, whole-asset, recurring, and media concerns

Exact-face concerns belong to the photo matching and review pipeline. They depend on materialization, assignee identity, suppressions, hidden state, blocked state, and operator precedence.

Whole-asset concerns belong to asset-level review and assignment. They are manual, assignee-based, and especially relevant when there is no exact face or when the media type is video.

Recurring profile concerns belong to tenant-managed identity and standing consent readiness. They become project-workspace concerns only after a recurring profile is added as a participant and a workspace-specific recurring consent state exists.

Upload and media concerns belong to private storage, workspace-scoped create/finalize flows, derivative generation, and preview delivery. Matching concerns belong to async comparison and canonical assignment. Review workflow concerns belong to workspace-local surfaces that let operators inspect, correct, suppress, hide, block, link, or export results, with the umbrella project acting as the staffing and navigation shell. The cleanest future changes keep those layers explicit instead of blending them together.

### A practical rule for future AI prompts

When writing future RPI prompts, explicitly state:

- the user-facing workflow being changed
- the current source-of-truth files to inspect
- the invariants that cannot move
- whether the change is expected to touch schema, public token flows, async workers, or media delivery
- what current behavior is historical versus current

That is the shortest path to good research, a bounded plan, and an implementation that fits the repo instead of fighting it.
