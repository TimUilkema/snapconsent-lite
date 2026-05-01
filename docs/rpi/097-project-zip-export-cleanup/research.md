# Feature 097 Research - Project ZIP Export Cleanup and Removal

## Title and Scope

Feature 097 researches removal of the legacy project ZIP export surface introduced by Feature 043.

Scope is research only. No code, migration, UI, test, route, helper, dependency, or runtime behavior changes are made in this phase.

The product direction to validate is:

- project finalization creates immutable release snapshots;
- released media is accessed through Media Library list/detail/download;
- Media Library folders provide organization-level curation;
- future DAM integration should build from release snapshots and Media Library identities;
- legacy on-demand project ZIP export should be removed or disabled without disturbing finalization, release creation, Media Library, correction/re-release, release asset safety context, or future DAM readiness.

## Inputs Reviewed

Required base documents:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

Required RPI history:

- `docs/rpi/043-simple-project-export-zip/research.md`
- `docs/rpi/043-simple-project-export-zip/plan.md`
- `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/research.md`
- `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/plan.md`
- `docs/rpi/074-project-release-package-and-media-library-placeholder/research.md`
- `docs/rpi/074-project-release-package-and-media-library-placeholder/plan.md`
- `docs/rpi/075-project-correction-and-re-release-foundation/research.md`
- `docs/rpi/075-project-correction-and-re-release-foundation/plan.md`
- `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/research.md`
- `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/plan.md`
- `docs/rpi/078-organization-scoped-media-library-folders-and-organization-foundation/research.md`
- `docs/rpi/078-organization-scoped-media-library-folders-and-organization-foundation/plan.md`
- `docs/rpi/079-project-correction-media-intake-and-release-asset-additions/research.md`
- `docs/rpi/079-project-correction-media-intake-and-release-asset-additions/plan.md`
- `docs/rpi/095-operational-permission-resolver-enforcement/research.md`
- `docs/rpi/095-operational-permission-resolver-enforcement/plan.md`
- `docs/rpi/096-permission-cleanup-and-effective-access-ui/research.md`
- `docs/rpi/096-permission-cleanup-and-effective-access-ui/plan.md`

Live source inspected:

- `src/app/api/projects/[projectId]/export/route.ts`
- `src/lib/project-export/project-export.ts`
- `src/lib/project-export/response.ts`
- `src/lib/project-export/naming.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/project-workflow-controls.tsx`
- `messages/en.json`
- `messages/nl.json`
- `package.json`
- `package-lock.json`
- `src/app/api/projects/[projectId]/finalize/route.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/project-releases/media-library-download.ts`
- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
- `src/lib/project-releases/media-library-release-safety.ts`
- `src/lib/project-releases/media-library-release-overlays.ts`
- `src/lib/media-library/media-library-folder-service.ts`
- `src/app/api/media-library/folders/**`
- `src/components/media-library/**`
- `src/components/navigation/protected-nav.tsx`
- `src/app/(protected)/layout.tsx`
- `src/lib/tenant/media-library-custom-role-access.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/projects/project-workspace-request.ts`
- `README_APP.md`
- `ARCHITECTURE.md`
- `DEPLOYMENT.md`
- current tests listed in the test strategy section

## Source-of-Truth Notes and Drift Found

Live code, migrations, and tests are authoritative over RPI docs.

Important drift and historical context:

- Feature 043 originally researched "one ZIP for one project." Live code is now workspace-scoped after later workspace features. The route exports the selected workspace, not the whole umbrella project.
- Feature 043 export remains photo-only. It filters `assets.asset_type = "photo"` and omits videos and headshots.
- Feature 074 explicitly rejected reusing ZIP export as the release package. Release snapshots are separate immutable rows built for Media Library and future DAM fit.
- Feature 073 and Feature 074 documented that export remains available after finalization. Live code still has no finalization requirement and no finalized-state block in the export route.
- Feature 096 intentionally preserved ZIP export as a restrictive legacy path planned for later removal. It did not migrate export to effective capabilities and did not add export to the effective access UI.
- `docs/rpi/SUMMARY.md` is already newer than much older RPI history and states that project export is older, photo-only, not release-grade, and not the Media Library download model.
- Live code confirms the Feature 096 preservation decision: `src/lib/project-export/response.ts` still calls `resolveWorkspacePermissions(...).canReviewProjects`.
- Live project page UI uses effective capabilities to show the export link, while the route uses legacy `canReviewProjects`. This creates a possible UI/API mismatch for project/workspace custom-role users with `review.workspace` or `correction.review`.

## Current ZIP Export Behavior

Route:

- Path: `GET /api/projects/[projectId]/export`
- File: `src/app/api/projects/[projectId]/export/route.ts`
- Runtime: `nodejs`
- Dynamic: `force-dynamic`
- Query string: optional `workspaceId`

Route entry:

- `GET(request, context)` reads `projectId` from route params.
- It reads `workspaceId` from `new URL(request.url).searchParams.get("workspaceId")`.
- It calls `createProjectExportResponse(...)` with:
  - `authSupabase: await createClient()`
  - `adminSupabase: createAdminClient()`
  - `projectId`
  - `requestedWorkspaceId`
- Errors are normalized through `jsonError(error)`.

Service entry points:

- `createProjectExportResponse(...)` in `src/lib/project-export/response.ts`
- `loadProjectExportRecords(...)` in `src/lib/project-export/project-export.ts`
- `buildPreparedProjectExport(...)` in `src/lib/project-export/project-export.ts`
- naming helpers in `src/lib/project-export/naming.ts`

Response type and streaming behavior:

- Returns a streaming `Response` with status `200`.
- Headers:
  - `Cache-Control: no-store`
  - `Content-Disposition: attachment; filename="<safe project folder>.zip"`
  - `Content-Type: application/zip`
  - `X-Content-Type-Options: nosniff`
- Uses `archiver("zip", { zlib: { level: 9 } })`.
- Pipes the archive into a `PassThrough`, then returns `Readable.toWeb(output)`.
- Storage objects are downloaded through the admin Supabase storage client and streamed into the archive with `Readable.fromWeb(data.stream())`.
- If an object is missing after the response starts, the output stream is destroyed and consuming `response.arrayBuffer()` rejects in tests.

ZIP contents:

- Root folder: `buildProjectFolderName(project.name, project.id)`.
- Subfolders:
  - `assets/`
  - `consent_forms/`
- Each exported photo is written under `assets/<sanitized original filename>`.
- Each exported photo also gets `assets/<asset stem>_metadata.json`.
- Each consent gets `consent_forms/<sanitized subject name or email>.json`.

File naming:

- Project folder name uses `sanitizeExportSegment(projectName, "project_<short id>")`.
- Download filename is `<projectFolderName>.zip`.
- Unsafe filename characters are replaced with underscores.
- Duplicate asset names receive `__asset_<short id>`.
- Duplicate consent names receive `__consent_<short id>`.
- Attachment filename escapes `"` and `\` to `_`.

Authorization path:

1. `authSupabase.auth.getUser()` must return a user, otherwise `401 unauthenticated`.
2. `resolveTenantId(authSupabase)` must return an active tenant, otherwise `403 no_tenant_membership`.
3. The route checks `projects` through the authenticated client with `.eq("tenant_id", tenantId).eq("id", projectId)`.
4. Missing project returns `404 project_not_found`.
5. `resolveProjectWorkspaceSelection(...)` selects a visible workspace:
   - it lists project workspaces through a service-role client;
   - visibility uses effective project/workspace capabilities;
   - requested `workspaceId` must be visible;
   - one visible workspace is auto-selected;
   - multiple visible workspaces without `workspaceId` returns `400 workspace_required`.
6. The route then calls legacy `resolveWorkspacePermissions(authSupabase, tenantId, user.id, projectId, selectedWorkspace.id)`.
7. It requires `workspacePermissions.canReviewProjects`.
8. Failure returns `403 project_export_forbidden` with message "Only owners, admins, and reviewers can export workspaces."

Project/workspace selection behavior:

- Export is workspace-scoped.
- It never exports all workspaces of the umbrella project in one ZIP.
- The route can auto-select when exactly one workspace is visible.
- With multiple visible workspaces and no `workspaceId`, it returns `workspace_required`.
- With a non-visible requested workspace, it returns `workspace_not_found`.

State requirements:

- No explicit requirement that the project is finalized.
- No explicit block for active, finalized, correction-open, archived, handed-off, validated, or needs-changes states in the export route.
- Export can run from mutable current project/workspace state as long as auth and workspace review permission pass.

Tables read directly by ZIP export:

- `projects`
- `assets`
- `consents`
- joined `subjects`
- `asset_face_materializations`
- `asset_face_materialization_faces`
- `asset_face_consent_links`
- `asset_assignee_links`
- `asset_consent_manual_photo_fallbacks`
- `project_consent_scope_signed_projections`

Tables read indirectly by ZIP export helpers:

- `memberships` through tenant/membership permission helpers
- `project_workspaces` through workspace selection
- role/reviewer/custom-role tables through effective workspace selection
- `project_face_assignees` and related one-off/recurring identity tables through `loadProjectFaceAssigneeDisplayMap(...)`
- scope state helper tables/views through `loadProjectConsentScopeStatesByConsentIds(...)` and `loadProjectConsentScopeStatesByParticipantIds(...)`

Storage reads:

- Reads original storage objects from `assets.storage_bucket` and `assets.storage_path`.
- Uses the service-role/admin Supabase storage client.
- Does not copy storage objects.

Release snapshot usage:

- ZIP export does not read `project_releases`.
- ZIP export does not read `project_release_assets`.
- ZIP export does not read `media_library_assets`.
- ZIP export does not use immutable release snapshot JSON.
- ZIP export reads live mutable project/workspace data at request time.

Data included:

- Uploaded, non-archived photo assets only.
- Original photo binaries.
- Asset metadata sidecars with project name/id, materialization, detected faces, linked consents, linked assignees, and owner scope state.
- Consent JSON for all workspace consents, including unlinked consents.
- Current subject name/email from the current `subjects` row.
- Current consent revocation status.
- Current exact-face links, whole-asset links, and zero-face fallback links.
- Effective scope state and signed scope projections/snapshot fallback.

Data omitted:

- Videos.
- Headshots.
- Release snapshots.
- Media Library stable asset identities and folders.
- DAM state.
- Hidden/blocked/suppressed/manual-face review safety context as release-detail context. Release snapshots and Feature 077 helpers cover that path instead.

Guardrails:

- `PROJECT_EXPORT_MAX_ASSET_COUNT = 200`
- `PROJECT_EXPORT_MAX_TOTAL_BYTES = 500 * 1024 * 1024`
- Guardrail failure throws `413 project_export_too_large`.
- Missing asset storage coordinates throw `500 project_export_asset_missing`.

Tests covering ZIP export:

- `tests/feature-043-simple-project-export-zip.test.ts`
  - naming sanitization and collision handling;
  - prepared export canonical face/fallback/empty behavior;
  - synchronous size guardrails;
  - missing storage coordinate failure;
  - authentication and tenant-membership failures;
  - cross-tenant project hiding;
  - photographer denial;
  - reviewer workspace-scoped ZIP download including original assets, sidecars, consents, and canonical current links;
  - guardrail enforcement before streaming;
  - stream abort when a storage object is missing.
- `tests/feature-073-project-workflow-foundation.test.ts`
  - imports `createProjectExportResponse`;
  - asserts finalization is explicit/idempotent and does not block export;
  - checks the response content type is `application/zip`.
- `tests/feature-058-project-local-assignee-bridge.test.ts`
  - imports `loadProjectExportRecords` and `buildPreparedProjectExport`;
  - uses export metadata assertions for recurring evidence, recurring whole-asset links, and exact-face supersession.

## Current UI Surface

Project detail page:

- File: `src/app/(protected)/projects/[projectId]/page.tsx`
- Export link appears in the project header action area next to section navigation.
- It renders as an `<a>` tag with:
  - href `/api/projects/${project.id}/export?workspaceId=${selectedWorkspace.id}`
  - label `t("exportProject")`
- English copy: `messages/en.json` key `projects.detail.exportProject` is "Export project".
- Dutch copy: `messages/nl.json` key `projects.detail.exportProject` is "Project exporteren".

Visibility condition:

- The link is shown when `(canOpenReviewWorkspace || canCorrectionReview) && selectedWorkspace`.
- `canOpenReviewWorkspace` is derived from effective workspace capability `review.workspace`.
- `canCorrectionReview` is derived from effective workspace capability `correction.review`.
- This is effective-capability UI gating, not the legacy fixed-role `canReviewProjects` route gate.

Role/permission implications:

- Fixed owner/admin users can generally see the link through effective capabilities.
- Reviewer users with effective reviewer access can see it.
- Project/workspace custom-role users with `review.workspace` or `correction.review` can see it in UI, but the route may reject them because it still requires legacy `canReviewProjects`.
- Photographers should not see it unless they somehow have effective review/correction-review capabilities.

State behavior:

- The UI condition is not tied directly to finalized state.
- The link can appear for active review-capable workspaces.
- The link can appear during correction when the user has `correction.review`.
- The link can appear after finalization if the selected workspace and effective capabilities remain available.
- There is no Media Library replacement copy near the export link today.

Other UI:

- `ProjectWorkflowControls` does not contain ZIP/export behavior.
- Navigation does not expose ZIP export directly.
- No other source component was found with "Download ZIP", "Export ZIP", "download package", "project package", or similar ZIP-specific copy.

## Media Library Replacement Path

Finalization and release snapshot creation:

- Route: `POST /api/projects/[projectId]/finalize`
- File: `src/app/api/projects/[projectId]/finalize/route.ts`
- Handler: `handleProjectFinalizePost(...)` in `src/lib/projects/project-workflow-route-handlers.ts`
- Authorization: `assertEffectiveProjectCapability` with `workflow.finalize_project`
- State transition: `finalizeProject(...)` in `src/lib/projects/project-workflow-service.ts`
- Release creation: after finalization succeeds, the handler calls `ensureProjectReleaseSnapshot(...)`.

Release snapshot behavior:

- Service: `src/lib/project-releases/project-release-service.ts`
- `ensureProjectReleaseSnapshot(...)`:
  - loads a finalized project;
  - finds an existing release by `(tenantId, projectId, source_project_finalized_at)`;
  - returns an existing published release unchanged;
  - repairs a building release by deleting/rebuilding child `project_release_assets`;
  - creates a new release version if none exists for the finalized timestamp;
  - builds immutable release asset rows from current project/workspace state;
  - includes `asset_type in ("photo", "video")`;
  - excludes headshots;
  - stores original bucket/path for download;
  - stores project/workspace metadata snapshots;
  - stores asset metadata snapshots;
  - stores consent/link/review/scope snapshots;
  - upserts stable `media_library_assets` identities by project/source asset lineage;
  - publishes the release by updating `project_releases.status` to `published`.
- Finalization partial failure behavior is intentionally repairable:
  - if release creation fails after project finalization, the route returns a warning payload;
  - retrying finalization can repair/create the release snapshot.

Correction and re-release:

- Correction state lives on `projects` and keeps prior release rows immutable.
- `startProjectCorrection(...)` requires an existing published release for the current finalized timestamp.
- Correction finalization advances `projects.finalized_at` and `ensureProjectReleaseSnapshot(...)` creates a later release version.
- `listMediaLibraryAssets(...)` defaults to the latest published release per project.
- Historical release asset detail remains accessible by direct id when authorized.
- Feature 079 tests verify corrected finalization includes new photo/video assets in v2 while v1 remains immutable.

Media Library browsing:

- List page: `src/app/(protected)/media-library/page.tsx`
- Detail page: `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- Data loaders:
  - `getMediaLibraryPageData(...)`
  - `listMediaLibraryAssets(...)`
  - `getReleaseAssetDetail(...)`
- Media Library reads `project_release_assets` and `project_releases`, not mutable project review tables.
- The protected nav shows Media Library only when `resolveMediaLibraryAccess(...)` returns `canAccess`.

Media Library download:

- Route: `GET /api/media-library/assets/[releaseAssetId]/download`
- Handler: `createMediaLibraryAssetDownloadResponse(...)`
- Authorization:
  - authenticated user;
  - active tenant from `resolveTenantId`;
  - `getReleaseAssetDetail(...)`;
  - `authorizeMediaLibraryAccess(...)`.
- Download behavior:
  - validates the release asset exists and belongs to a published release;
  - reads original storage bucket/path from the release asset snapshot row;
  - creates a 120-second signed URL with the admin storage client;
  - returns `302` redirect to the signed URL.
- Missing source object/path returns `409 release_asset_source_missing`.

Media Library safety context:

- Feature 077 helpers derive safety and overlay context from immutable release snapshot JSON.
- The list/detail UI shows blocked/restricted advisory states.
- Download warnings are UI-only confirmation through `MediaLibraryDownloadButton`.
- The download route remains authorize-and-redirect; it does not mutate release rows or project review state.

Media Library folders:

- Service: `src/lib/media-library/media-library-folder-service.ts`
- Tables:
  - `media_library_folders`
  - `media_library_folder_memberships`
  - `media_library_assets`
- Supported operations:
  - list active folders;
  - create;
  - rename;
  - archive;
  - add assets;
  - move assets;
  - remove assets.
- Folder management is authorized through `authorizeMediaLibraryFolderManagement(...)`.
- Folder identities are stable across release versions through `media_library_assets`.

What users should do instead of ZIP export:

- Finalize the project to create a release snapshot.
- Use Media Library to browse the latest released assets.
- Use Media Library detail to inspect release snapshot safety, owner, permission, and review context.
- Use Media Library download for individual original released assets.
- Use Media Library folders for organization-level curation.
- Future bulk delivery or DAM sync should build from `project_releases`, `project_release_assets`, and `media_library_assets`, not from `src/lib/project-export`.

Missing Media Library capabilities relevant to ZIP removal:

- Media Library does not currently provide a bulk ZIP/package export.
- This is not a blocker for the stated product decision because ZIP export is no longer desired.
- If a future bulk delivery feature is needed, it should be a release/Media-Library package concept, not the old mutable workspace ZIP path.

## Removal Strategy Options

### Option A - Delete ZIP export route and UI completely

Delete:

- `src/app/api/projects/[projectId]/export/route.ts`
- `src/lib/project-export/`
- project page export link
- `projects.detail.exportProject` messages if no longer used
- Feature 043 ZIP tests
- direct ZIP export assertions in later tests
- `archiver` dependency if no other runtime import exists
- `jszip` dev dependency if no other tests need it after ZIP tests are removed

Pros:

- Cleanest alignment with product direction.
- App is not in production, so external backwards compatibility is not required.
- Removes a mutable-data delivery path that can be mistaken for release output.
- Removes the UI/API permission mismatch caused by effective UI gating and legacy route authorization.
- Removes the last live route caller of `resolveWorkspacePermissions(...).canReviewProjects`.
- Prevents accidental future use of `project-export` helpers for DAM or release packaging.
- Reduces dependency surface by likely removing `archiver` and `jszip`.

Cons:

- Any missed internal references will fail at compile/test time.
- Some tests use export helpers as assertions for matching/assignee metadata and must be rewritten to use current live view-models or release snapshot assertions.
- Documentation must clearly explain Media Library as the post-finalization path.

Fit:

- Recommended if implementation verifies references are small enough to remove in one PR-sized slice.
- Current live references are discoverable and limited enough for this option.

### Option B - Hide UI and return 410 Gone from route

Remove the project page link and most helper code, but keep a tiny route returning `410 Gone` with a clear JSON error such as `project_export_removed`.

Pros:

- Clear response if a stale internal link is missed during development.
- Avoids a framework 404 for a known intentionally removed feature.
- Allows a test to assert the removal response.

Cons:

- Keeps a dead API route surface.
- Requires deciding and maintaining removal copy/error code.
- App is not in production, so backward compatibility is not needed.
- Still invites future code to special-case a legacy endpoint.

Fit:

- Use only if implementation discovers widespread internal route references or a short local transition is safer.
- Current research does not show enough internal reachability to require this.

### Option C - Keep route but restrict/mark deprecated

Keep current route behavior and only document deprecation.

Pros:

- Smallest code change.
- Keeps existing tests green with minimal effort.

Cons:

- Does not complete the cleanup.
- Contradicts current product direction.
- Keeps old mutable workspace export alive.
- Keeps legacy permission path alive.
- Keeps the UI/API mismatch unless the UI is also hidden.
- Keeps `archiver` and ZIP test dependencies.
- Increases risk that future DAM/package work reuses the wrong abstraction.

Fit:

- Not recommended unless a hard blocker is found in plan/implementation.

Recommendation from research: choose Option A. Use Option B only if the implementation phase uncovers hidden internal consumers that make immediate route deletion too disruptive. Reject Option C.

## Authorization Implications

Current export authorization is deliberately legacy:

- UI visibility uses effective workspace capabilities.
- Route authorization uses `resolveWorkspacePermissions(...).canReviewProjects`.
- Feature 096 preserved this as a restrictive removal-boundary path and explicitly did not broaden it to project/workspace custom-role users.

Removing ZIP export would:

- remove the last live source caller of `resolveWorkspacePermissions(...).canReviewProjects`;
- remove the route-facing `project_export_forbidden` path;
- remove the need to decide a new export-specific effective capability;
- avoid broadening project/workspace custom-role users into a deprecated delivery path;
- keep Media Library authorization separate through `media_library.access` and `media_library.manage_folders`;
- keep finalization authorization on `workflow.finalize_project`;
- keep correction/re-release authorization on workflow/correction capabilities;
- keep public-token flows separate.

What removal does not automatically allow:

- It does not mean `resolveWorkspacePermissions` can be deleted entirely. It still defines legacy compatibility types/helpers and is used by older tests and compatibility helper paths.
- It does not mean `canReviewProjects` can be removed from every type. `WorkspacePermissions` and tests still use it.
- It does not change Media Library access. Project/workspace operational custom roles still should not imply Media Library unless the user has `media_library.access`.
- It does not change reviewer assignment semantics.

Feature 096 follow-up:

- `docs/rpi/SUMMARY.md` should be updated to replace "ZIP export remains restrictive and planned for removal" with "ZIP export was removed; Media Library/release snapshots are the delivery path."
- Any Feature 096 comments or tests that preserve ZIP behavior should be removed or updated.
- If implementation removes the route entirely, do not add a new export capability or effective-access UI entry.

## Files to Remove or Update

### Delete

- `src/app/api/projects/[projectId]/export/route.ts`
- `src/lib/project-export/project-export.ts`
- `src/lib/project-export/response.ts`
- `src/lib/project-export/naming.ts`
- `tests/feature-043-simple-project-export-zip.test.ts`

### Update

- `src/app/(protected)/projects/[projectId]/page.tsx`
  - Remove the export link from the header action area.
  - Do not replace it with another project ZIP/package action.
- `messages/en.json`
  - Remove `projects.detail.exportProject` if no longer used.
  - Add Media Library replacement copy only if the implementation plan intentionally adds UI copy.
- `messages/nl.json`
  - Same as English.
- `tests/feature-073-project-workflow-foundation.test.ts`
  - Remove import/use of `createProjectExportResponse`.
  - Replace "finalization does not block export" assertion with release snapshot/Media Library-safe finalization assertions that already match the current product direction.
- `tests/feature-058-project-local-assignee-bridge.test.ts`
  - Replace export-helper metadata assertions with release snapshot assertions or direct current-model assertions.
  - Keep the core recurring assignee/whole-asset/exact-face behavior coverage.
- `package.json`
  - Remove `archiver` if no remaining import exists.
  - Remove `jszip` if no remaining test uses it.
- `package-lock.json`
  - Update through package manager in implementation, after dependency removal is verified.
- `docs/rpi/SUMMARY.md`
  - Update project export, Media Library, Feature 096, and drift sections.
- `DEPLOYMENT.md`
  - It says `SUPABASE_SERVICE_ROLE_KEY` is used by uploads, exports, workers, matching, derivatives. After removal, update "exports" if no other export-like server feature uses the service role.

### Keep

- `src/lib/project-releases/project-release-service.ts`
- `src/lib/project-releases/media-library-download.ts`
- `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- `src/components/media-library/**`
- `src/lib/media-library/media-library-folder-service.ts`
- `src/app/api/media-library/folders/**`
- `src/lib/tenant/media-library-custom-role-access.ts`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/app/api/projects/[projectId]/finalize/route.ts`
- shared asset signing/display helpers used by project UI or Media Library
- scope state helpers used by release snapshots or project UI
- assignee/matching helpers used outside export

### Replace with Media Library copy

- If the project page needs post-finalization guidance, use Media Library/release wording instead of ZIP wording.
- Copy should direct users to Media Library as the released media access path.
- Do not introduce a "download package" or "project package" promise unless a release-package feature exists.

### Remove tests

- Delete Feature 043 ZIP generation tests if Option A is chosen.
- Delete or rewrite tests that only prove ZIP auth, ZIP streaming, ZIP naming, ZIP sidecars, or ZIP guardrails.

### Update tests

- Rewrite Feature 073 finalization test to avoid export.
- Rewrite Feature 058 export metadata assertions to release snapshots or direct assignee/link assertions.
- Add a project page UI test or component-level assertion that the project page/header no longer renders the export action if practical.
- Add route removal/410 test only if Option B is chosen. For Option A, route deletion may be covered by compile/reference checks rather than a runtime route test.

## Test Strategy

ZIP-specific tests to remove:

- `tests/feature-043-simple-project-export-zip.test.ts`
  - all ZIP naming, assembly, auth, guardrail, and streaming behavior is obsolete if Option A is chosen.

Tests to update:

- `tests/feature-073-project-workflow-foundation.test.ts`
  - remove `createProjectExportResponse` import.
  - remove assertion that finalization "does not block export."
  - keep/idempotency/finalization behavior assertions.
  - assert release snapshot behavior through existing release tests rather than ZIP.
- `tests/feature-058-project-local-assignee-bridge.test.ts`
  - remove imports from `src/lib/project-export/project-export`.
  - preserve coverage for recurring project assignee bridge, recurring whole-asset links, and exact-face supersession.
  - use release snapshot rows or current matching/assignee service output as the assertion target.

Tests to keep green:

- `tests/feature-073-project-workflow-foundation.test.ts`
- `tests/feature-073-project-workflow-routes.test.ts`
- `tests/feature-073-project-workflow-ui.test.tsx`
- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-074-media-library-download.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`
- `tests/feature-077-media-library-release-helpers.test.ts`
- `tests/feature-077-media-library-ui.test.ts`
- `tests/feature-078-media-library-folders.test.ts`
- `tests/feature-078-media-library-folder-routes.test.ts`
- `tests/feature-078-media-library-ui.test.ts`
- `tests/feature-079-correction-media-intake-foundation.test.ts`
- `tests/feature-085-custom-role-media-library-enforcement.test.ts`
- `tests/feature-095-operational-permission-resolver-enforcement.test.ts`
- `tests/feature-096-permission-cleanup-and-effective-access-ui.test.ts`

Possible new tests:

- Project page no longer includes `/api/projects/{projectId}/export` or `exportProject` action for review-capable users.
- Messages no longer contain unused `exportProject` keys if removed.
- Dependency/reference check can be manual through search:
  - no `project-export` imports;
  - no `/api/projects/${project.id}/export` references;
  - no runtime `archiver` import;
  - no `JSZip` test import.
- If Option B is chosen instead:
  - route returns `410 Gone`;
  - no UI links point to it;
  - no export helpers or ZIP dependencies remain unless the route still needs none of them.

Recommended verification command in implementation:

- `npm test`
- If time/scope requires targeted first pass:
  - `npm test -- tests/feature-058-project-local-assignee-bridge.test.ts tests/feature-073-project-workflow-foundation.test.ts tests/feature-074-project-release-media-library.test.ts tests/feature-074-media-library-download.test.ts tests/feature-075-project-correction-workflow.test.ts tests/feature-077-media-library-release-helpers.test.ts tests/feature-078-media-library-folders.test.ts tests/feature-079-correction-media-intake-foundation.test.ts tests/feature-095-operational-permission-resolver-enforcement.test.ts tests/feature-096-permission-cleanup-and-effective-access-ui.test.ts`

## Documentation Updates

Required documentation updates during implementation:

- `docs/rpi/SUMMARY.md`
  - Remove or revise current sections that describe ZIP export as a live legacy path.
  - State that project ZIP export was removed in Feature 097.
  - State that finalized project output is accessed through release snapshots and Media Library.
  - State that future DAM integration should build from release snapshots and stable Media Library identities.
  - Update Feature 096 note that ZIP export was preserved only temporarily and is now removed.
- `README_APP.md`
  - No current ZIP/export mention found. No update required unless implementation adds replacement guidance.
- `ARCHITECTURE.md`
  - No current ZIP export output-path mention found.
  - Optional update: strengthen the release snapshot/Media Library boundary if desired.
- `DEPLOYMENT.md`
  - Update `SUPABASE_SERVICE_ROLE_KEY` usage list if "exports" only meant project ZIP export.
- `messages/en.json` and `messages/nl.json`
  - Remove stale project export copy if the UI link is removed.
  - Add replacement Media Library copy only if plan includes visible user guidance.

Do not rewrite older RPI feature docs. They are historical context. Newer summary documentation should call out the removal and the new product direction.

## Risks and Guardrails

Risks:

- Accidentally deleting release snapshot code because it reused export concepts historically.
- Accidentally breaking Media Library download by removing shared storage/signing helpers. Current Media Library download does not depend on `src/lib/project-export`.
- Accidentally deleting matching/assignee/scope helpers still used by release snapshots, project UI, or tests.
- Leaving a stale project page link to a removed route.
- Leaving stale tests that import `project-export`.
- Removing `archiver` or `jszip` before verifying there are no remaining imports.
- Rewriting Feature 058 tests too broadly and losing coverage for recurring assignee and whole-asset invariants.
- Treating Media Library access as equivalent to project/workspace review access. It is a separate release/tenant boundary.
- Broad permission cleanup around `resolveWorkspacePermissions` going beyond the removal scope.
- Accidentally changing correction finalization/re-release behavior.
- Accidentally changing public token flows.
- Accidentally introducing a new package/export concept without product design.

Guardrails:

- Delete only project-export-specific code and references.
- Keep finalization route and release snapshot service behavior unchanged.
- Keep Media Library list/detail/download behavior unchanged.
- Keep Media Library folder behavior unchanged.
- Keep correction/re-release behavior unchanged.
- Keep Media Library authorization unchanged.
- Keep project/workspace custom-role access unchanged.
- Do not add a ZIP replacement endpoint.
- Do not add a new export capability.
- Do not broaden project/workspace custom-role access.
- Do not remove shared helpers unless search proves they are only used by project export.

## Recommendation

Proceed in the plan phase with Option A: delete the legacy project ZIP export route, helper library, UI link, ZIP-specific tests, and unused ZIP dependencies after verifying imports.

The implementation direction should be:

1. Remove the project page export action.
2. Delete the `GET /api/projects/[projectId]/export` route.
3. Delete `src/lib/project-export/`.
4. Remove Feature 043 ZIP tests.
5. Rewrite later tests that used export helpers as assertion targets.
6. Remove `archiver` and `jszip` if no imports remain.
7. Update `docs/rpi/SUMMARY.md` and any stale documentation references.
8. Keep finalization, release snapshot creation, Media Library list/detail/download, Media Library folders, release safety context, correction, and re-release code unchanged.

Do not choose Option C. Choose Option B only if the implementation phase discovers hidden internal route consumers that make immediate deletion uncomfortably risky.

## Explicit Open Decisions for Plan Phase

1. Should the removed route be deleted completely (Option A) or replaced with a minimal `410 Gone` route (Option B)?
2. What exact assertion should replace the Feature 073 "finalization does not block export" test?
3. Should Feature 058 export metadata assertions move to release snapshot assertions, direct current-model assertions, or a smaller targeted helper test?
4. Should the project page include post-finalization guidance to Media Library, or is removing the export button enough for this slice?
5. Should `DEPLOYMENT.md` be updated in Feature 097 because it mentions service role use by "exports"?
6. Should `docs/rpi/SUMMARY.md` be the only long-lived documentation update, or should `ARCHITECTURE.md` also get a short release/Media Library delivery-path note?
7. If Option A deletes the route, should a runtime test assert absence, or is compile/search verification sufficient in a Next App Router project?
