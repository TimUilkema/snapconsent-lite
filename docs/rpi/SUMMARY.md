# SnapConsent RPI Summary for AI Coding Agents

This is the long-lived project context for SnapConsent RPI work. Read it first, then verify targeted details against live code before changing behavior.

## 1. Source-of-truth order

When sources disagree, resolve conflicts in this order:

1. Live application code in `src/`.
2. Live database, storage, SQL helper, and RLS migrations in `supabase/migrations/`.
3. Current tests in `tests/`.
4. Newer RPI feature docs under `docs/rpi/`.
5. Older RPI feature docs under `docs/rpi/`.
6. Older summary docs.

Current live code, migrations, and tests override old RPI research or plans. RPI docs explain intent and history, but they are not authoritative when implementation has moved on.

## 2. Last verified scope

Last verified: 2026-05-01.

Highest RPI feature reviewed: Feature 097, `097-project-zip-export-cleanup`.

Recent feature status:

| Feature | Status at this update | Notes |
| --- | --- | --- |
| 092 capability scope semantics and migration map | Research/plan reference | Defines capability scope semantics and migration map. It is not a standalone runtime feature. Its matrix is implemented through later code, especially `src/lib/tenant/custom-role-scope-effects.ts`, `src/lib/tenant/effective-permissions.ts`, and Feature 095 enforcement. |
| 093 scoped custom role assignment foundation | Implemented | `docs/rpi/093.../research.md` was not present. Plan, live code, and tests are the source. |
| 094 effective scoped permission resolver foundation | Implemented | Resolver and SQL helper are present. |
| 095 operational permission resolver enforcement | Implemented | Capture, review, workflow, and correction paths use effective capabilities at project/workspace scope. |
| 096 permission cleanup and effective access UI | Implemented | Operational read cleanup and owner/admin effective-access explanations are present. |
| 097 project ZIP export cleanup | Implemented | Project ZIP route/helpers/tests/dependencies are absent; release snapshots and Media Library are the delivery path. |

This update is documentation-only. No app code, migrations, tests, routes, services, UI components, messages, or configuration were intentionally changed.

Important drift captured here:

- Feature 096 still treated ZIP export as a restrictive legacy path. Feature 097 supersedes that: ZIP export is removed.
- Project-scoped `project_workspaces.manage` exists in the scope matrix and effective resolver, but the current project administration service still enforces project creation and workspace management through fixed roles plus tenant-scope custom role helpers.
- Feature 093 has no research document in the repo; use its plan, tests, and live code.
- There is no root `README.md` at this verification point; use `README_APP.md`.

### RPI feature index

This index lists the feature folders currently present under `docs/rpi/`, excluding `archive/`. Descriptions summarize the RPI intent; live code, migrations, and tests remain the source of truth when details drift.

- `001-auth` - Adds Supabase SSR authentication for the Next.js App Router. Establishes authenticated protected routes and the initial server-side auth boundary.
- `002-projects-invites` - Introduces projects and public consent invite flows. Defines tenant-scoped project/invite storage and token-based invite signing boundaries.
- `003-consent-templates` - Builds the consent template model. Establishes reusable template/version concepts that later features extend with editing, publishing, and structured fields.
- `004-project-assets` - Adds tenant/project-scoped asset upload foundations. Defines how project media is stored, listed, and tied to consent workflows.
- `005-duplicate-upload-handling` - Adds duplicate upload detection for project assets. Focuses on content identity and retry-safe handling of repeated uploads.
- `006-headshot-consent` - Extends public consent with headshot capture. Adds storage and consent linkage for subject headshots used by later matching features.
- `007-origin-url-consistency` - Standardizes app-origin and public URL generation. Reduces drift between redirects, shareable links, and server-side generated external URLs.
- `008-asset-thumbnails` - Adds thumbnail support for project assets. Defines private storage signing and UI integration for lightweight media previews.
- `009-matching-foundation` - Establishes the first consent-centric matching data model. Adds server helpers for linking and unlinking faces to consent records.
- `010-auto-face-matching` - Adds the initial asynchronous auto-matching worker backbone. Introduces queueing and reconciliation concepts for face matching jobs.
- `011-real-face-matcher` - Connects the matching backbone to a real face matcher. Integrates provider-backed comparison without redesigning the queue architecture.
- `012-manual-review-likely-matches` - Adds manual review of likely face matches. Creates a review surface for accepting or rejecting candidate matches.
- `013-match-results-observability` - Improves visibility into match results and worker outcomes. Adds result tracking so matching behavior can be inspected and debugged.
- `014-ui-navigation-refresh` - Refreshes protected app navigation around the growing workflow. Improves route organization and operator access to major app areas.
- `015-headshot-replace-resets-suppressions` - Fixes replacement headshots so stale suppressions do not block new matching. Keeps suppression behavior scoped to the old headshot evidence.
- `016-compreface-service-fit` - Researches whether CompreFace fits the current matching architecture. Captures service behavior, integration constraints, and performance implications.
- `017-face-result-geometry-and-embeddings` - Persists matched-face geometry and embeddings. Keeps evidence for matched asset/consent pairs available for review and future export needs.
- `018-compreface-performance-efficiency` - Adds bounded worker-level parallelism and performance tuning around CompreFace usage. Reduces inefficient serial matching behavior while preserving worker limits.
- `019-face-materialization-deduped-embedding-pipeline` - Reworks matching around materialized faces and deduped embedding comparisons. Separates face materialization from compare fan-out for reuse and scale.
- `020-materialized-headshot-resolution-bug` - Fixes materialized worker failures when resolving headshot sources. Keeps the Feature 019 pipeline from retrying indefinitely on missing or misresolved headshot data.
- `021-project-matching-progress-ui` - Adds project-level matching progress visibility. Surfaces matching queue/materialization state in the UI so operators can see work advancing.
- `022-asset-upload-performance` - Early asset upload performance feature folder with no research or plan documents currently present. Verify live code/history before relying on this folder for implementation detail.
- `023-bugfix-requesturi` - Fixes Request-URI-too-large failures from unsafe large `.in(...)` query patterns. Batches or restructures dangerous reads without redesigning matching.
- `024-upload-performance-resumability` - Improves large photo upload throughput and interruption recovery. Adds resumability-oriented client/server behavior while preserving tenant scoping and idempotency.
- `025-matching-queue-robustness` - Hardens the matching queue against stalled or inconsistent jobs. Focuses on retry behavior, failure classification, and safe recovery.
- `026-prevent-partial-materialization-orchestration-failures` - Prevents materialization success from leaving compare fan-out stranded after orchestration failure. Adds retry-safe repair paths for partially completed matching setup.
- `028-duplicate-upload-detection-regression-after-batched-upload` - Restores duplicate detection correctness after batched upload changes. Ensures uploaded photos have authoritative content hashes before duplicate policy decisions.
- `029-complete-bounded-matching-fanout` - Makes large-project matching eventually complete without unbounded fan-out. Adds continuation behavior so compare work progresses in bounded chunks.
- `030-continuation-retry-reliability` - Hardens Feature 029 continuation retries. Ensures continuation jobs can be retried safely after transient failures or partial progress.
- `031-one-consent-per-face-precedence-rules` - Enforces one current consent assignment per detected face. Defines precedence rules where manual review decisions override automatic suggestions.
- `032-face-consent-linking-ui-improvements` - Improves the face-to-consent linking workflow after precedence rules. Makes manual linking clearer without changing canonical face assignment semantics.
- `033-asset-face-overlays-and-confidence` - Adds asset face overlays and match confidence context. Helps reviewers understand detected faces and current consent confidence on preview surfaces.
- `034-materialization-repair-and-overlay-regressions` - Repairs stale or incomplete face materialization affecting overlays and review. Adds bounded forced rematerialization and fixes overlay regressions.
- `035-embedding-compare-response-alignment-bug` - Fixes a provider response alignment bug that could attach scores to the wrong face. Protects multi-face photo matching from incorrect candidate assignment.
- `036-matchable-photo-pagination` - Adds pagination for matchable photo reads. Keeps review and matching surfaces usable for larger projects.
- `037-consent-matching-panel-layout` - Refines the consent matching panel layout. Focuses on making asset grids and matching controls easier to scan and use.
- `038-original-image-ingest-and-display-derivatives` - Introduces a shared image ingest pipeline with original preservation and display derivatives. Expands accepted image inputs while using normalized derivatives for UI rendering.
- `039-consent-form-template-editor` - Adds a richer consent form template editor. Supports reusable form configuration while preserving the existing template/version model.
- `040-asset-display-derivatives-reliability` - Fixes reliability gaps where UI surfaces still used originals instead of display derivatives. Makes derivative generation and use more explicit, async, and repairable.
- `041-ui-language-switch` - Adds Dutch/English UI localization support. Establishes the language switch and message-file pattern for user-facing UI text.
- `042-structured-consent-template-fields` - Adds structured fields to consent templates. Lets consent forms capture typed field values beyond plain consent text.
- `043-simple-project-export-zip` - Adds an early simple ZIP export for project assets. This legacy delivery path is later superseded and removed by Feature 097.
- `044-asset-preview-linking-ux-improvements` - Improves asset preview linking interactions. Makes reviewer workflows for linking faces or assets to consent more ergonomic.
- `045-asset-preview-unlinked-faces-and-hidden-face-suppression` - Adds handling for unlinked faces and hidden-face suppression in asset previews. Helps reviewers suppress irrelevant detections without creating false consent links.
- `046-template-editor-live-preview-and-layout-builder` - Adds live preview and layout-builder behavior to the template editor. Improves authoring feedback for structured consent forms.
- `047-manual-face-box-creation-in-asset-preview` - Allows reviewers to create manual face boxes when detection misses a person. Supports consent linkage for faces not found by automatic materialization.
- `048-block-person-assignment-for-faces-without-consent` - Adds a safety state for faces without consent. Prevents blocked/no-consent faces from being assigned as if they had valid consent.
- `049-recurring-profiles-and-consent-management-foundations` - Starts the recurring profile and recurring consent domain. Establishes foundations for people who appear across multiple projects.
- `050-recurring-profile-directory-foundation` - Adds the recurring profile directory. Provides tenant-scoped profile browsing and basic profile management foundations.
- `051-baseline-recurring-consent-request-foundation` - Adds baseline recurring consent request support. Enables standing consent requests tied to recurring profiles outside a single project.
- `052-baseline-request-management` - Adds management workflows for baseline recurring consent requests. Covers request state, operator actions, and tenant-scoped access patterns.
- `053-recurring-consent-history-and-inline-profile-detail` - Adds recurring consent history and inline profile detail surfaces. This folder has only a plan document, so verify live code for exact implementation.
- `053-recurring-consent-history-and-profile-detail` - Adds profile detail and recurring consent history. Gives operators clearer visibility into consent state over time.
- `054-baseline-follow-up-actions` - Adds follow-up actions for baseline recurring consent. Helps operators continue or resolve baseline request workflows after initial send/signing.
- `055-project-participants-and-mixed-consent-intake` - Adds project participants and mixed one-off/recurring consent intake. Bridges recurring profiles into project-specific consent workflows.
- `056-recurring-profile-headshots-and-matching-materialization-foundation` - Adds recurring profile headshots and materialization foundations. Prepares recurring profiles to participate in face matching.
- `057-project-matching-integration-for-ready-recurring-profiles` - Integrates ready recurring profiles into project matching. Uses selected profile headshots and match authorization to feed matching jobs.
- `058-project-local-assignee-bridge-for-profile-backed-matches` - Adds project-local assignee identities for recurring profiles. Lets review link faces to project participants through a project-scoped bridge.
- `059-auto-assignment-for-project-scoped-recurring-assignees` - Adds auto-assignment for recurring profile assignees in projects. Extends matching so recurring participants can receive automatic candidate links.
- `060-project-unresolved-face-review-queue` - Adds an unresolved face review queue. Helps reviewers find faces that still need consent assignment, suppression, or blocking.
- `060-tenant-resolution-hardening` - Hardens active tenant resolution. Protects multi-tenant sessions from ambiguous or client-controlled tenant selection.
- `061-link-consent-to-whole-asset` - Adds whole-asset consent linking. Allows reviewers to assign an entire asset to consent when face-level linking is insufficient or inappropriate.
- `062-video-upload-foundation` - Adds video asset upload foundations. Extends the asset model and upload flow beyond photos while preserving tenant/project scoping.
- `062a-remove-video-duplicate-checking-from-upload-flow` - Removes video duplicate checking from upload flow. Avoids unreliable or expensive duplicate behavior for video uploads.
- `063-video-asset-preview-playback-and-thumbnails` - Adds video preview playback and thumbnails. Lets operators inspect video assets inside the review UI.
- `063a-video-poster-thumbnail-performance-investigation` - Investigates video poster thumbnail performance. Captures constraints and performance issues around generating or displaying video preview images.
- `064-whole-asset-linking-for-video-assets` - Extends whole-asset linking to video assets. Provides consent assignment support for videos where face-level review may not apply.
- `065-recurring-profile-multi-face-manual-selection` - Adds manual selection for recurring profile headshots with multiple faces. Lets operators choose the correct face for matching readiness.
- `066-post-finalize-matching-job-enqueue-reliability` - Improves reliability of matching job enqueueing around finalized projects. Prevents post-finalize job gaps from leaving release or review state stale.
- `067-consent-scope-state-and-upgrade-requests` - Adds consent scope state and upgrade request foundations. Tracks when existing consent is insufficient and supports asking subjects for expanded consent.
- `068-outbound-email-foundation-with-local-emulation-and-typed-email-jobs` - Adds the central outbound email foundation. Introduces typed email jobs, local emulation, and the server-side pattern for external links.
- `069-consent-upgrade-flow-owner-reuse-and-prefill-refinement` - Refines consent upgrade flows to reuse known owner/subject context and prefill data. Improves upgrade request ergonomics without changing the broader email foundation.
- `070-tenant-rbac-and-organization-user-management-foundation` - Adds tenant RBAC and organization user management foundations. Defines fixed roles, membership management, and tenant-scoped administrative boundaries.
- `071-consent-upgrade-flow-headshot-reuse-and-upgrade-ux-fixes` - Fixes upgrade flow headshot reuse and related UX issues. Keeps consent upgrade requests from forcing unnecessary duplicate headshot work.
- `072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions` - Adds umbrella projects, photographer-scoped workspaces, and bounded workflow permissions. Separates capture staffing from broad project administration.
- `073-workspace-handoff-and-project-finalization-foundation` - Adds workspace handoff, validation, and project finalization foundations. Establishes state transitions that gate release creation.
- `074-project-release-package-and-media-library-placeholder` - Adds release package creation and a Media Library placeholder. Starts immutable release snapshot behavior for finalized projects.
- `075-project-correction-and-re-release-foundation` - Adds correction mode and re-release foundations. Allows finalized projects to reopen for targeted correction while preserving prior releases.
- `076-correction-consent-intake-and-authorization-updates` - Adds correction consent intake and authorization updates. Ensures correction-mode public and member actions carry valid provenance and workflow state.
- `077-media-library-asset-safety-and-release-detail-review-context` - Improves Media Library asset safety and release detail review context. Keeps library reads tied to released snapshots instead of mutable live project state.
- `078-organization-scoped-media-library-folders-and-organization-foundation` - Adds organization-scoped Media Library folders. Introduces stable library asset organization without mutating release snapshots.
- `079-project-correction-media-intake-and-release-asset-additions` - Adds correction-mode media intake and release asset additions. Lets correction flows add media and publish later releases with the new assets.
- `080-advanced-organization-access-management-foundation` - Adds a fixed-role capability catalog and clearer organization access model. Prepares the app for custom role definitions and delegated capabilities.
- `081-custom-role-definitions-and-scoped-role-assignment-foundation` - Adds durable role definition, capability, and assignment tables. This is a foundation slice that does not yet change runtime authorization behavior.
- `082-project-scoped-reviewer-assignments-and-enforcement` - Enforces explicit reviewer access assignments. Replaces automatic tenant-wide reviewer access with assignment-backed review access while preserving owner/admin behavior.
- `083-custom-role-editor-foundation` - Adds the owner/admin custom role definition editor. Lets administrators create, edit, and archive reusable tenant custom roles.
- `084-custom-role-assignment-foundation` - Adds tenant-scope custom role assignment workflows. Lets owners/admins assign and revoke custom roles for existing tenant members.
- `085-custom-role-media-library-enforcement` - Enforces tenant custom roles for Media Library access. Makes `media_library.*` capabilities affect library authorization.
- `086-custom-role-template-profile-enforcement` - Enforces tenant custom roles for templates and recurring profiles. Adds delegated access for `templates.*` and `profiles.*` capabilities.
- `087-tenant-level-admin-permission-consolidation` - Consolidates tenant-level project administration custom-role enforcement. Applies delegated tenant admin capabilities to project creation and workspace administration surfaces.
- `088-organization-user-management-custom-role-enforcement` - Adds custom-role enforcement for organization user read/list and invite flows. Delegates the safest member-management slice without role administration.
- `089-organization-user-role-change-and-removal-custom-role-enforcement` - Adds bounded custom-role enforcement for organization user role changes and removal. Restricts delegated mutations to allowed operational targets.
- `090-role-administration-delegation` - Records the decision not to delegate role administration. Keeps custom role editing, assignment, and reviewer access administration fixed owner/admin-only.
- `091-owner-admin-role-administration-consolidation` - Hardens the owner/admin-only role administration boundary. Consolidates tests and UI/service behavior around the non-delegation decision.
- `092-capability-scope-semantics-and-permission-migration-map` - Defines capability scope semantics and the remaining permission migration map. Serves as a research/plan reference rather than a standalone runtime feature.
- `093-scoped-custom-role-assignment-foundation` - Adds tenant, project, and workspace custom role assignment foundations. Validates assignment targets, scope effects, warnings, and zero-effective assignment rejection.
- `094-effective-scoped-permission-resolver-foundation` - Adds the scoped effective permission resolver foundation. Combines fixed roles, reviewer assignments, photographer staffing, and scoped custom roles without migrating callers yet.
- `095-operational-permission-resolver-enforcement` - Migrates operational project/workspace authorization to the effective resolver. Applies scoped capabilities to capture, review, workflow, and correction routes with state checks preserved.
- `096-permission-cleanup-and-effective-access-ui` - Cleans up permission reads and adds owner/admin effective access explanations. Makes current access sources, ignored capabilities, and assignment warnings inspectable.
- `097-project-zip-export-cleanup` - Removes the legacy project ZIP export surface. Establishes release snapshots and Media Library as the supported delivery path.

## 3. Product overview

SnapConsent is a tenant-scoped consent and media workflow app for organizations that collect, manage, review, and release media under explicit consent.

The core product flow:

- A tenant configures consent templates, including structured fields and reusable published versions.
- Subjects can sign one-off public invites or recurring profile consent requests.
- Subjects can later revoke consent through token-protected public revocation links.
- Tenants maintain recurring profiles for people who appear repeatedly across projects.
- Projects contain one or more workspaces, including default and photographer workspaces.
- Photographers and capture-capable users upload photos, videos, and public invite headshots.
- Matching materializes faces, compares them to consent/headshot sources, and queues review.
- Reviewers link faces or whole assets to consent, suppress or hide faces, and resolve exceptions.
- Project finalization creates immutable release snapshots.
- Media Library reads released snapshots through stable library asset identities.
- Correction mode opens a finalized project for targeted consent/media intake and creates later releases.
- Future DAM integration should build from release snapshots and Media Library identities, not from old project ZIP export behavior.

## 4. Core scopes and boundaries

Do not collapse these scopes. Many bugs in this app come from treating them as interchangeable.

| Scope or boundary | Meaning | Important constraints |
| --- | --- | --- |
| Tenant | Organization/account boundary. Almost every table stores `tenant_id`. | Every DB query must be tenant-scoped. Never accept `tenant_id` from the client. Derive it server-side via `src/lib/tenant/resolve-tenant.ts`. |
| Active tenant | The tenant selected for the authenticated session. | `sc_active_tenant` is validated against memberships. If a user has multiple tenants and no valid active tenant, resolution can require selection. |
| Membership | A user's fixed role inside a tenant. | Stored in `memberships`. Fixed roles are `owner`, `admin`, `reviewer`, `photographer`. |
| Fixed membership role | Coarse base role. | Owner/admin are special. Reviewer/photographer eligibility is not the same as current operational access. |
| Umbrella project | Project-level container for workspaces, recurring participants, workflow, finalization, correction, and releases. | Project-level custom-role scope is broader than a workspace but still not tenant-wide. |
| Project workspace | Operational unit for capture/review. | Workspace access is where photographer staffing and many operational capabilities land. |
| Public token | Tokenized non-member access for signing, revocation, invite acceptance, and public headshot upload. | Public token flows do not use member/custom-role effective permission checks. They use token validity plus workflow/provenance checks. |
| Project release | Immutable snapshot produced by finalization. | Later correction creates a later release. Prior releases are not mutated as a way to change history. |
| Media Library stable asset identity | Tenant-level identity for a released source asset lineage. | `media_library_assets` is upserted by tenant/project/source asset lineage during release publication and can be organized into folders. |
| Tenant role assignment scope | Custom role assignment applying at tenant scope. | Valid only for tenant-scope capabilities. Operational capabilities are `defer` at tenant scope and are ignored for tenant custom-role assignments. |
| Project role assignment scope | Custom role assignment applying to one project. | Valid for project-level operational capabilities and `project_workspaces.manage` according to the matrix. |
| Workspace role assignment scope | Custom role assignment applying to one workspace. | Valid for workspace-level operational capabilities. Not valid for tenant admin or project-only workflow capabilities. |

## 5. Current permission model

The fixed roles are:

- `owner`
- `admin`
- `reviewer`
- `photographer`

Owner and admin are special:

- They have broad fixed operational capability.
- They remain the only roles that can administer role definitions, custom role assignments, and reviewer access.
- Delegated operational capabilities do not authorize role administration.

The runtime model separates role definitions from role assignments:

- System role definitions mirror fixed/system concepts and support durable assignment rows such as reviewer access.
- Tenant custom role definitions are reusable capability bundles created by owner/admin users.
- Role assignments grant a role definition to a member at `tenant`, `project`, or `workspace` scope.
- Permission semantics are additive.
- There are no deny rules.
- Revoked assignments are ignored.
- Archived custom role definitions are ignored by the effective resolver.
- Unsupported scope/capability combinations are ignored and surfaced as ignored capabilities where the UI asks for an explanation.
- Workflow and correction state-machine checks remain separate from capability checks.

Effective permission sources are currently:

- Fixed membership role.
- System reviewer assignments.
- Photographer workspace assignment.
- Tenant custom role assignments.
- Project custom role assignments.
- Workspace custom role assignments.

The central TypeScript resolver is `src/lib/tenant/effective-permissions.ts`. It resolves tenant/project/workspace capabilities and returns source metadata.

What remains outside the effective resolver:

- Role administration: custom role create/edit/archive, custom role assignment/revoke, and reviewer access grant/revoke stay fixed owner/admin-only.
- Public token flows under `/i`, `/rp`, `/r`, `/rr`, `/join`, and public invite headshot endpoints.
- Release snapshot immutability and release build/repair logic.
- Media Library surface-specific release/download details, even though `media_library.*` capabilities exist at tenant scope.
- Workflow/correction state-machine checks such as finalized projects, workspace handoff, correction-open state, and correction provenance.
- Idempotency, audit, provenance, and retry-safety rules.

Key files:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/custom-role-scope-effects.ts`
- `src/lib/tenant/effective-permissions.ts`
- `src/lib/tenant/custom-role-service.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/organization-user-access.ts`
- `src/lib/tenant/permissions.ts`

## 6. Capability scope matrix

Scope values:

- `yes`: the capability is effective at that assignment/target scope.
- `no`: the capability is invalid at that assignment/target scope.
- `defer`: tenant-scope assignment is intentionally not treated as tenant-wide operational access.
- `not_applicable`: the scope does not make product sense for that capability.

The matrix source is `src/lib/tenant/custom-role-scope-effects.ts`. The capability catalog source is `src/lib/tenant/role-capabilities.ts`.

| Capability | Tenant scope | Project scope | Workspace scope | Current migration/enforcement status |
| --- | --- | --- | --- | --- |
| `organization_users.manage` | yes | no | no | Tenant-scope delegated member directory/read support. Enforced by `src/lib/tenant/organization-user-access.ts`, `src/lib/tenant/member-management-service.ts`, member routes, and SQL/RLS helpers from Features 088-089. |
| `organization_users.invite` | yes | no | no | Tenant-scope delegated invites for allowed target roles. Enforced by member management services/routes and SQL/RLS helpers. |
| `organization_users.change_roles` | yes | no | no | Tenant-scope delegated fixed-role changes for reviewer/photographer targets only. No owner/admin mutation by delegated users. |
| `organization_users.remove` | yes | no | no | Tenant-scope delegated removal for reviewer/photographer targets only. No self removal and no owner/admin removal by delegated users. |
| `templates.manage` | yes | no | no | Tenant-scope template management and project default template selection. Enforced by `src/lib/templates/template-service.ts` and SQL helpers from Feature 086. |
| `profiles.view` | yes | no | no | Tenant-scope recurring profile read. Enforced by `src/lib/profiles/profile-access.ts` and profile services/routes. |
| `profiles.manage` | yes | no | no | Tenant-scope recurring profile/profile-type/headshot/baseline consent management. Implies view in the service layer. |
| `projects.create` | yes | not_applicable | not_applicable | Tenant-scope project creation. Enforced by `src/lib/projects/project-administration-service.ts`; fixed owner/admin and tenant custom role supported. |
| `project_workspaces.manage` | yes | yes | no | Tenant-scope project workspace admin is enforced today by `src/lib/projects/project-administration-service.ts`. The matrix/resolver also support project-scope grants, but current project administration enforcement still uses tenant custom-role helpers. |
| `capture.workspace` | defer | yes | yes | Operational capture/read/handoff capability. Enforced through effective project/workspace resolver after Feature 095. Tenant custom-role assignment is ignored. |
| `capture.create_one_off_invites` | defer | yes | yes | Normal one-off invite create/revoke. Enforced through effective workspace capability. Correction-mode one-off intake uses `correction.consent_intake`. |
| `capture.create_recurring_project_consent_requests` | defer | yes | yes | Normal project participant and recurring project consent request creation. Enforced through effective workspace capability. |
| `capture.upload_assets` | defer | yes | yes | Normal project media upload/preflight/prepare/finalize. Enforced through effective workspace capability. |
| `review.workspace` | defer | yes | yes | Normal review and workspace review transitions. Enforced through effective project/workspace resolver. Does not grant Media Library. |
| `review.initiate_consent_upgrade_requests` | defer | yes | yes | Normal consent upgrade request creation. Enforced through effective workspace capability. |
| `workflow.finalize_project` | defer | yes | no | Project finalization. Enforced through effective project capability. State validation is separate. |
| `workflow.start_project_correction` | defer | yes | no | Start correction on a finalized project. Enforced through effective project capability. State validation is separate. |
| `workflow.reopen_workspace_for_correction` | defer | yes | yes | Reopen a validated workspace during correction. Enforced through effective workspace/project support. State validation is separate. |
| `correction.review` | defer | yes | yes | Review mutations after finalization/correction context. Enforced through effective workspace capability plus correction state checks. |
| `correction.consent_intake` | defer | yes | yes | Correction-mode invites, recurring participant requests, and upgrade intake. Enforced through effective workspace capability plus correction provenance/state checks. |
| `correction.media_intake` | defer | yes | yes | Correction-mode media uploads. Enforced through effective workspace capability plus correction state checks. |
| `media_library.access` | yes | no | no | Tenant-scope Media Library access. Enforced by `src/lib/tenant/media-library-custom-role-access.ts` and release/Media Library services. Project review access does not imply this. |
| `media_library.manage_folders` | yes | no | no | Tenant-scope Media Library folder create/rename/archive/membership management. Enforced by `src/lib/media-library/media-library-folder-service.ts`. |

SQL helper strategy:

- Older tenant-only surfaces use tenant custom-role helpers such as `src/lib/tenant/tenant-custom-role-capabilities.ts` and migration helpers from Features 085-089.
- Feature 094 adds scoped custom-role capability SQL helper support.
- Feature 095 adds operational SQL/RLS helper parity so RLS and route logic can express the same effective scoped checks.
- Route handlers should still call explicit TypeScript services/helpers instead of open-coding role logic.

## 7. Already migrated permission areas

| Area | Current status | Key files/helpers |
| --- | --- | --- |
| Media Library | Custom-role tenant access is enforced. Owner/admin, tenant-wide reviewer access, and tenant custom roles can access/manage according to `media_library.*`. Project reviewer access does not grant Media Library. | `src/lib/tenant/media-library-custom-role-access.ts`, `src/lib/project-releases/project-release-service.ts`, `src/lib/project-releases/media-library-download.ts`, `src/lib/media-library/media-library-folder-service.ts`, Media Library routes/pages. |
| Templates | Tenant custom role `templates.manage` is enforced for create/version/publish/archive and project default template selection. | `src/lib/templates/template-service.ts`, Feature 086 SQL helpers/tests. |
| Profiles | Tenant custom roles `profiles.view` and `profiles.manage` are enforced. Manage implies view. | `src/lib/profiles/profile-access.ts`, profile directory/consent/headshot services, Feature 086 tests. |
| Project creation | `projects.create` is enforced for fixed owner/admin and tenant-scope custom roles. | `src/lib/projects/project-administration-service.ts`, project routes, Feature 087 tests. |
| Project workspace management | Fixed owner/admin and tenant-scope custom role support are enforced today. Matrix/resolver support project-scope grants, but project admin service has not been fully migrated to scoped effective resolver. | `src/lib/projects/project-administration-service.ts`, workspace routes, Feature 087 tests. |
| Organization-user read/list/invite | Delegated tenant custom-role support is enforced. Delegated users get a reduced directory and invite only allowed roles. | `src/lib/tenant/organization-user-access.ts`, `src/lib/tenant/member-management-service.ts`, member routes, Features 088-089. |
| Organization-user role change/remove | Delegated tenant custom-role support is enforced for reviewer/photographer targets only. Owner/admin targets and self-removal stay protected. | `src/lib/tenant/organization-user-access.ts`, `src/lib/tenant/member-management-service.ts`, Feature 089 tests. |
| Custom role editor | Owner/admin-only create/edit/archive. Delegated operational capabilities do not grant editor access. | `src/lib/tenant/custom-role-service.ts`, `src/components/members/custom-role-management-section.tsx`, Features 083 and 091 tests. |
| Custom role assignment | Owner/admin-only tenant-scope assignment/revoke foundation. | `src/lib/tenant/custom-role-assignment-service.ts`, Feature 084 tests. |
| Scoped custom role assignment | Owner/admin-only tenant/project/workspace assignment/revoke. Assignment target validation, scope warnings, zero-effective rejection, and assignment-id revocation are implemented. | `src/lib/tenant/custom-role-assignment-service.ts`, `src/lib/tenant/custom-role-scope-effects.ts`, scoped assignment UI, Feature 093 tests. |
| Effective scoped resolver | Implemented in TypeScript and SQL helper form. Fixed roles, reviewer assignments, photographer workspace assignments, and scoped custom roles are combined additively. | `src/lib/tenant/effective-permissions.ts`, migration `20260501130000_094_scoped_custom_role_capability_helper.sql`, Feature 094 tests. |
| Operational routes after Feature 095 | Capture, review, workflow, and correction routes use effective project/workspace capabilities. Old fixed owner/admin, reviewer assignment, and photographer staffing sources are preserved. | `src/lib/projects/project-workspace-request.ts`, `src/lib/projects/project-workflow-route-handlers.ts`, project routes, migration `20260501140000_095_operational_permission_resolver_enforcement.sql`, Feature 095 tests. |
| Effective access UI after Feature 096 | Owner/admin-only explanation of current fixed role, custom role assignments, reviewer access, photographer workspace assignments, effective scopes, ignored capabilities, and warnings. | `src/lib/tenant/member-effective-access-service.ts`, `src/app/api/members/[userId]/effective-access/route.ts`, `src/components/members/member-management-panel.tsx`, `messages/en.json`, `messages/nl.json`, Feature 096 tests. |

## 8. Role administration boundary

Role administration is intentionally not delegated through custom capabilities.

Current boundaries:

- Custom role create/edit/archive is fixed owner/admin-only.
- Custom role assignment/revoke is fixed owner/admin-only.
- Reviewer access grant/revoke is fixed owner/admin-only.
- Effective access explanation is fixed owner/admin-only.
- Delegated organization-user capabilities can invite/change/remove allowed operational members, but do not expose role editor, custom role assignment, or reviewer access administration.

The following capability keys do not exist in the live catalog:

- `custom_roles.manage`
- `custom_roles.assign`
- `reviewer_access.manage`
- `roles.manage`
- `roles.assign`

Feature 090/091 decision: do not introduce delegated role administration. Keep role admin constrained to fixed owner/admin unless a later feature explicitly changes that decision.

Key files:

- `src/lib/tenant/custom-role-service.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/member-effective-access-service.ts`
- `tests/feature-091-owner-admin-role-administration-consolidation.test.ts`

## 9. Reviewer access model

The fixed `reviewer` membership role is eligibility, not automatic project access by itself.

Reviewer access is represented by active system reviewer role assignments in `role_assignments`:

- Tenant-wide reviewer assignment grants review/workflow/correction across projects and Media Library access/folder management.
- Project reviewer assignment grants project/workspace review/workflow/correction for that project.
- Project reviewer assignment does not grant Media Library access.
- Reviewer access uses the system reviewer role definition, not tenant custom role definitions.
- Reviewer access coexists additively with custom-role review capabilities.
- Owner/admin grant/revoke reviewer access through `src/lib/tenant/reviewer-access-service.ts`.
- Removing reviewer membership or changing a reviewer out of the fixed reviewer role revokes reviewer access as part of member management cleanup.

Media Library implication:

- Tenant-wide reviewer access grants `media_library.access` and `media_library.manage_folders`.
- Project reviewer access does not.
- Custom project/workspace review roles do not imply Media Library.

## 10. Photographer workspace assignment model

Photographer workspace assignment remains a special staffing/capture source.

Current behavior:

- A project workspace can have `photographer_user_id`.
- If the user is a fixed `photographer` member and is assigned to that workspace, the effective resolver grants capture capabilities for that workspace.
- The source is reported as `photographer_workspace_assignment`.
- It is separate from custom role assignment.
- It is preserved for compatibility with existing staffing workflows and project workspace management.
- Do not assume it is replaced by scoped custom roles unless a later feature explicitly does that.

Key files:

- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/tenant/effective-permissions.ts`
- `src/lib/tenant/member-effective-access-service.ts`

## 11. Operational authorization model

Post-Feature-095 operational routes check effective capabilities, then state-machine rules.

Capture:

- Normal workspace capture/read/handoff uses `capture.workspace`.
- One-off invite create/revoke uses `capture.create_one_off_invites`.
- Project recurring participant/request creation uses `capture.create_recurring_project_consent_requests`.
- Normal media upload/preflight/prepare/finalize uses `capture.upload_assets`.
- Sources preserved: owner/admin fixed role, photographer workspace assignment, and scoped custom roles.
- Tenant-scope operational custom role assignments are ignored because those capabilities are `defer` at tenant scope.
- State checks still reject finalized projects, invalid workspace states, and non-correction submissions where appropriate.

Review:

- Normal review and review transitions use `review.workspace`.
- Normal consent upgrade initiation uses `review.initiate_consent_upgrade_requests`.
- Sources preserved: owner/admin fixed role, reviewer access assignments, and scoped custom roles.
- Review capability does not grant Media Library.
- Review mutations still respect workspace handoff/validation/correction state checks.

Workflow and finalization:

- Project finalization uses `workflow.finalize_project` at project scope.
- Starting project correction uses `workflow.start_project_correction` at project scope.
- Reopening a workspace for correction uses `workflow.reopen_workspace_for_correction`.
- Route helpers pass these capability keys through `src/lib/projects/project-workflow-route-handlers.ts`.
- Finalization validation remains in `src/lib/projects/project-workflow-service.ts`; capability alone does not bypass unresolved blockers, unvalidated workspaces, or release snapshot constraints.

Correction:

- Correction review uses `correction.review`.
- Correction consent intake uses `correction.consent_intake`.
- Correction media intake uses `correction.media_intake`.
- Correction-mode one-off invites, recurring participant requests, and upgrade requests use correction consent intake rather than normal capture/review capability.
- Correction-mode uploads use correction media intake.
- Correction public token submissions require correction provenance snapshots to match the currently open correction.

Important files:

- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/projects/project-participants-route-handlers.ts`
- `src/lib/projects/project-consent-upgrade-route-handlers.ts`
- `src/lib/assets/project-correction-asset-route-handlers.ts`
- Project API routes under `src/app/api/projects/**`
- Project page `src/app/(protected)/projects/[projectId]/page.tsx`

## 12. Public token flows

Public token flows are not member permission flows. They do not call the custom-role effective resolver to decide if the public actor can act.

Current public boundaries:

- One-off invite signing: `/i/[token]` and `/i/[token]/consent`.
- Recurring consent signing: `/rp/[token]` and `/rp/[token]/consent`.
- One-off revocation: `/r/[token]` and `/r/[token]/revoke`.
- Recurring revocation: `/rr/[token]` and `/rr/[token]/revoke`.
- Organization invite acceptance: `/join/[token]` and `/join/[token]/accept`.
- Public one-off headshot upload/finalize: `/api/public/invites/[token]/headshot` and `/api/public/invites/[token]/headshot/[assetId]/finalize`.

These flows use token lookup, expiry/status checks, request provenance, idempotency, workflow state checks, and public-safe error redirects/responses. They can use admin clients server-side to validate token context, but they must not accept tenant or project identity from the public client as authority.

Public signing and public headshot upload use workflow checks from `src/lib/projects/project-workflow-service.ts`:

- Normal submission is blocked after project finalization.
- Correction submission is allowed only when the token's correction provenance matches the active correction context.

## 13. Release snapshots and Media Library

Project finalization creates release snapshots through `ensureProjectReleaseSnapshot` in `src/lib/project-releases/project-release-service.ts`.

Release behavior:

- Releases are stored in `project_releases`.
- Released assets are stored in `project_release_assets`.
- Release assets include uploaded `photo` and `video` project assets.
- Release asset rows snapshot project, workspace, source asset metadata, consent/link/review/scope state, faces, hidden/blocked faces, manual fallback links, whole-asset links, and effective consent scope state.
- If a finalized release already exists for the same `source_project_finalized_at`, finalization returns the published release summary.
- If a release is stuck or partially built, the release builder repairs child rows in place and republishes.
- Release publication upserts stable `media_library_assets` by tenant/project/source asset lineage.

Correction and re-release:

- Starting correction does not mutate the previous release.
- Correction intake updates current project state.
- Re-finalization creates a later release version tied to the new finalized timestamp.
- Media Library list reads the latest published release per project.

Media Library behavior:

- List/detail are released snapshot reads, not live project asset reads.
- Download uses `src/lib/project-releases/media-library-download.ts`, validates Media Library access, loads released asset detail, and redirects to a short-lived signed storage URL for the original source asset.
- Folder management uses stable `media_library_assets`, `media_library_folders`, and `media_library_folder_memberships`.
- Future DAM integration should start from `project_releases`, `project_release_assets`, and `media_library_assets`.

## 14. Project ZIP export status

Feature 097 is implemented.

Current status:

- Project ZIP export is removed.
- There is no project export API route under `src/app/api/projects/[projectId]/export`.
- There is no `src/lib/project-export/` implementation.
- ZIP export tests are absent.
- ZIP libraries such as `archiver`/`jszip` are absent from `package.json`.
- UI/messages no longer treat ZIP export as a supported long-term delivery path.

Product direction:

- Media Library and release snapshots are the supported delivery path.
- Future DAM integration should build from Media Library/release snapshots.
- Do not invest in permission redesign around the removed ZIP export path.
- If bulk delivery is needed later, add it as a release/Media Library/DAM capability, not by restoring old project ZIP semantics without a new RPI decision.

## 15. Templates

Template model:

- Templates are tenant-scoped unless they are app templates with `tenant_id = null`.
- Tenant templates have a stable `template_key` and version rows with `version`, `version_number`, and `status`.
- Status values include `draft`, `published`, and `archived`.
- Published versions are what projects/public consent should use.
- Structured fields and form layout definitions are stored with the template version.
- Creating a new tenant template and creating a version use idempotency keys.
- Publishing validates structured fields/form layout and handles publish conflicts.
- Archiving applies to published tenant versions.
- Project default template selection only accepts visible published templates.

Authorization:

- Template management uses fixed `templates.manage` or tenant custom role `templates.manage`.
- Project default-template changes are treated as template-management actions, not broad project-administration grants.
- Key service: `src/lib/templates/template-service.ts`.

## 16. Recurring profiles and recurring consent

Recurring profile model:

- Profile directory and profile types are tenant-scoped.
- Profiles have statuses such as active/archived.
- Profile types are tenant-managed classification labels.
- Profile directory reads require `profiles.view` or `profiles.manage`.
- Profile/profile-type/headshot/baseline request mutations require `profiles.manage`.

Recurring consent:

- Baseline recurring consent requests capture standing consent for a profile.
- Project recurring consent requests attach a recurring profile to a project/workspace and can ask for project-specific consent.
- Recurring consent public signing uses `/rp/[token]`.
- Recurring revocation uses `/rr/[token]`.
- Profile headshots support recurring profile matching readiness.
- Headshot upload/finalize/selection/materialization lives under `src/lib/profiles/profile-headshot-service.ts`.
- Project recurring participants live in `project_profile_participants` and related recurring consent request/consent tables.
- Project participant routes use capture/correction operational capabilities, not profile directory permissions.

Matching materialization:

- Recurring profile headshots are materialized and selected for matching.
- Project recurring sources are bridged into project-local assignees for matching/review.
- Matching readiness considers active match authorization and usable selected headshot face state.

## 17. One-off consent and public invite flows

One-off model:

- Capture-capable members create subject invites for a project workspace.
- Invites are tenant/project/workspace-scoped and expose a public `/i/[token]` signing path.
- Public signing validates token status/expiry and workflow state.
- Submissions create consent records with subject identity, consent acknowledgment, face-match opt-in, structured field values, request provenance, IP/user agent where available, and revoke token.
- Public invite headshot upload creates/finalizes `headshot` assets through token context and idempotency.
- Correction-mode one-off invites carry correction provenance snapshots and are authorized by `correction.consent_intake` for the member route.

Revocation:

- One-off revoke links use `/r/[token]`.
- Recurring revoke links use `/rr/[token]`.
- Revocation marks consent revoked but does not delete historical consent records or release snapshots.

Email:

- Outbound public links must use the central outbound email foundation and `APP_ORIGIN`/`src/lib/url/external-origin.ts` pattern.
- Consent receipts, tenant membership invites, and other outbound mail should not call SMTP/provider code directly from feature code.

## 18. Assets, matching, review

Asset model:

- Asset types include `photo`, `video`, and `headshot`.
- Project media upload stores original metadata, storage bucket/path, upload status, content hash, and workspace/project/tenant ownership.
- Upload writes should remain idempotent and retry-safe.
- Derivatives and thumbnails are handled by asset worker endpoints/jobs.

Matching model:

- Photos are materialized into `asset_face_materializations` and `asset_face_materialization_faces`.
- Face materialization uses current materializer version/provider metadata.
- Headshots and recurring profile selected faces feed matching.
- Matching jobs are queued/reconciled through matching worker services and internal token-protected endpoints.
- The project-local assignee bridge lets one-off consents and recurring profile participants appear as assignment targets for review.

Review model:

- Reviewers link materialized faces to project face assignees.
- Manual faces can be created where detector output is insufficient.
- Whole-asset links can assign an asset to consent/assignee without relying only on detected faces.
- Faces can be hidden or blocked.
- Blocked faces encode no-consent safety state.
- Suppressions prevent unwanted assignee/consent links from resurfacing.
- Manual photo fallbacks are included in release snapshots.

Authorization:

- Normal review uses `review.workspace`.
- Consent upgrade initiation uses `review.initiate_consent_upgrade_requests`.
- Correction review uses `correction.review`.
- Operational read of assets/matching progress uses effective workspace operational capabilities after Feature 096.

## 19. Workflow, finalization, correction

Workspace workflow:

- Workspaces move through active/capture, handoff, review, needs-changes, and validated style states.
- Capture handoff uses `capture.workspace`.
- Review validation/needs-changes/reopen operations use review or workflow/correction capabilities depending on route/context.
- Workflow service checks remain authoritative for state transitions.

Project finalization:

- Finalization requires `workflow.finalize_project`.
- The workflow service validates all workspaces and unresolved blockers.
- Successful finalization sets finalized state and creates or repairs a release snapshot.
- Finalization is idempotent around existing published release snapshots for the same finalized timestamp.

Correction:

- Starting correction requires `workflow.start_project_correction`.
- A project must already be finalized and have a published source release.
- Reopening a workspace for correction requires `workflow.reopen_workspace_for_correction`.
- Correction consent intake uses `correction.consent_intake`.
- Correction media intake uses `correction.media_intake`.
- Correction review uses `correction.review`.
- Public correction submissions require token provenance matching the active correction.
- Re-finalization publishes a later release rather than mutating the earlier release.

Key files:

- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/assets/project-correction-asset-route-handlers.ts`
- `src/lib/project-releases/project-release-service.ts`

## 20. Media Library and folders

Media Library surfaces:

- Protected Media Library page under `src/app/(protected)/media-library/**`.
- Media Library API routes under `src/app/api/media-library/**`.
- Release asset detail/download routes use released snapshot IDs, not live asset IDs.

Stable identity and folders:

- `media_library_assets` stores stable identities for released source asset lineages.
- `media_library_folders` stores active/archived tenant folders.
- `media_library_folder_memberships` assigns a stable Media Library asset identity to a folder.
- Folder writes use service-role operations server-side after explicit authorization and tenant validation.
- Folder membership writes are idempotent where practical and detect conflicts when an asset already belongs to another folder.

Safety context:

- Media Library reads released consent/link/review/scope snapshots.
- The library should not silently reinterpret old releases through current mutable project state.
- Folder organization is a library concern and does not mutate release snapshots.

Authorization:

- Access requires owner/admin, tenant-wide reviewer access, or tenant custom role `media_library.access`.
- Folder management requires owner/admin, tenant-wide reviewer access, or tenant custom role `media_library.manage_folders`.
- Project reviewer assignments and project/workspace operational custom roles do not grant Media Library.

Future DAM:

- Build DAM sync/export from published release snapshots and stable Media Library asset identities.
- Keep release snapshot immutability and consent provenance intact.

## 21. Email, matching, asset jobs

Outbound email:

- Central foundation lives under `src/lib/email/outbound/`.
- New outbound email features should enqueue typed jobs and add centralized render/registry entries.
- Do not call SMTP/provider code directly from feature services.
- External links should use `APP_ORIGIN` and `src/lib/url/external-origin.ts`.
- Local SMTP preview uses Mailpit as documented in `README_APP.md`.

Matching jobs:

- Matching worker/reconcile endpoints are token-protected internal endpoints.
- `MATCHING_INTERNAL_TOKEN` protects matching job processing/reconcile routes.
- Matching jobs cover consent headshot readiness, photo fanout, materialization, comparison, and replay from recurring project participants.

Asset jobs:

- Asset derivative/thumbnail repair endpoints are token-protected internal endpoints.
- `ASSET_WORKER_INTERNAL_TOKEN` protects asset derivative worker routes.
- Asset derivative and repair flows should remain retry-safe.

Do not expose service-role keys or internal worker tokens to client code.

## 22. UI conventions

Read `UNCODEXIFY.md` before UI changes.

Current UI direction:

- No broad IAM-style dashboard.
- Members UI is restrained and task-oriented.
- Owner/admin users see role editor, reviewer access controls, custom role assignment controls, and effective access explanations.
- Delegated member-management users see reduced organization-user surfaces only; they do not see role editor/custom role assignment/reviewer access admin state.
- Effective access UI is explanatory, not a new authorization source.
- Scoped custom role assignment UI should show scope effects/warnings rather than pretending every capability works at every scope.
- Navigation should reflect actual access helpers, not hardcoded role assumptions.

i18n:

- The repo includes messages in `messages/en.json` and `messages/nl.json`.
- New user-facing UI strings should use the existing i18n setup and add English and Dutch messages.
- Stored domain content remains unchanged; localize UI chrome, labels, buttons, helper text, and validation copy.

## 23. Testing and validation commands

Use the actual scripts in `package.json` and project docs:

| Purpose | Command |
| --- | --- |
| Install dependencies | `npm install` |
| Dev server | `npm run dev` |
| Lint | `npm run lint` |
| Full test suite | `npm test` |
| Next production build | `npm run build` |
| Unsafe IN-filter check | `npm run check:in-filters` |
| Reset local Supabase data | `supabase db reset` |

The `test` script is `tsx --test --test-concurrency=1 tests/**/*.test.ts`.

Relevant test families:

- Tenant/membership/active tenant: Feature 070 and Feature 060 tenant resolution tests.
- Workflow/finalization/correction: Features 073, 075, 076, 079.
- Release/Media Library/folders/download: Features 074, 077, 078.
- Capability catalog and role foundations: Features 080, 081, 082, 083, 084.
- Custom-role enforcement: Features 085, 086, 087, 088, 089.
- Role administration boundary: Feature 091.
- Scoped assignment/effective resolver/operational enforcement/effective access UI: Features 093, 094, 095, 096.

For documentation-only changes to this file, tests are usually unnecessary. Still run targeted commands if the update discovers broken docs tooling or if behavior files are touched.

## 24. Remaining future work

Known future or cleanup areas at this verification point:

- DAM integration from release snapshots and stable Media Library identities.
- Decide whether project-scoped `project_workspaces.manage` should be wired into project administration enforcement through the effective resolver; the matrix supports it, but current service enforcement is tenant-scope custom role based.
- Decide whether reviewer access should remain a special system assignment model long-term. Do not change it incidentally.
- Decide whether photographer workspace assignment should remain special staffing or be replaced by scoped custom roles. Do not assume replacement.
- Add any future bulk delivery/export as a release/Media Library/DAM feature rather than restoring old ZIP export behavior.
- Consider resolver batching/performance work for pages that evaluate many project/workspace scopes.
- Clean up old compatibility helpers in `src/lib/tenant/permissions.ts` only when route/services/tests no longer depend on them.
- Continue production hardening around audit trails, retry behavior, rate limits, token expiry handling, and partial failure repair paths.

Do not list ZIP export removal as future work. It is complete as of Feature 097.
