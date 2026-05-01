# Feature 097 - Project ZIP Export Cleanup and Removal Plan

## Scope and contract

This plan covers implementation for removing the legacy project ZIP export surface introduced by Feature 043.

The implementation must:

- remove the project ZIP export UI action;
- delete the project ZIP export API route;
- delete ZIP-export-specific helper code once references are removed;
- remove ZIP-export-specific tests and rewrite tests that used export helpers for unrelated assertions;
- remove ZIP generation dependencies only after import verification;
- keep project finalization, release snapshot creation, Media Library list/detail/download, folders, safety context, and correction/re-release behavior unchanged;
- update documentation so the supported post-finalization delivery path is release snapshots and the Media Library.

The implementation must not add a replacement package export, Media Library bulk ZIP download, DAM integration, new capability keys, public token changes, finalization changes, release snapshot changes, correction changes, or Media Library authorization changes.

## Inputs and ground truth

Required inputs reviewed:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/097-project-zip-export-cleanup/research.md`

Targeted live verification reviewed:

- `src/app/api/projects/[projectId]/export/route.ts`
- `src/lib/project-export/project-export.ts`
- `src/lib/project-export/response.ts`
- `src/lib/project-export/naming.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `messages/en.json`
- `messages/nl.json`
- `tests/feature-043-simple-project-export-zip.test.ts`
- `tests/feature-058-project-local-assignee-bridge.test.ts`
- `tests/feature-073-project-workflow-foundation.test.ts`
- release, Media Library, correction, and permission test filenames listed below
- `package.json`
- `package-lock.json`
- `docs/rpi/SUMMARY.md`
- `README_APP.md`
- `ARCHITECTURE.md`
- `DEPLOYMENT.md`

Live code, migrations, and tests remain authoritative over the RPI documents.

## Drift from research

No blocking drift was found.

Targeted verification confirmed the research recommendation:

- the only live API route is `GET /api/projects/[projectId]/export`;
- the route delegates to `createProjectExportResponse`;
- `src/lib/project-export/` is ZIP-export-specific;
- `archiver` is only imported by `src/lib/project-export/response.ts`;
- `JSZip`/`jszip` is only used by `tests/feature-043-simple-project-export-zip.test.ts`;
- the only live UI link is in `src/app/(protected)/projects/[projectId]/page.tsx`;
- the only live UI message key is `projects.detail.exportProject`;
- no suitable page-level UI test currently renders the project detail action row, so the implementation should rely on search/build/lint verification rather than adding a heavy page test.

Documentation drift to address:

- `docs/rpi/SUMMARY.md` still treats Feature 043 as an active ZIP export capability in multiple historical references.
- `DEPLOYMENT.md` says the service role key is used by "exports"; targeted verification indicates that this means the legacy ZIP export unless another export-like feature is found during implementation.
- `README_APP.md` and `ARCHITECTURE.md` did not show stale ZIP export references in targeted verification.

## Chosen removal strategy

Choose Option A: delete ZIP export route and UI completely.

Implementation decision:

- delete `src/app/api/projects/[projectId]/export/route.ts`;
- do not add a replacement route;
- do not keep a temporary `410 Gone` route;
- rely on compile, lint, targeted tests, full tests if practical, and repository searches to catch stale internal references.

Rationale:

- the app is not in production;
- external backward compatibility is not required;
- live internal references are narrow and can be removed directly;
- deleting the route removes a mutable project-data export path and reduces attack surface;
- a retained `410 Gone` route would keep a dead product surface that the product decision explicitly removes.

Option B, a tiny `410 Gone` route, should only be reconsidered if implementation discovers a hidden internal consumer that cannot be safely removed in the same change. If used, the route must not import old export helpers and must return a small JSON error such as `project_export_removed`.

Option C, keeping the route as deprecated, is rejected because it leaves the old permission and export path alive.

## Route/helper removal plan

Delete:

- `src/app/api/projects/[projectId]/export/route.ts`
- `src/lib/project-export/project-export.ts`
- `src/lib/project-export/response.ts`
- `src/lib/project-export/naming.ts`
- the `src/lib/project-export/` directory if empty after deletion

Before deletion, remove or rewrite the known imports:

- `tests/feature-043-simple-project-export-zip.test.ts`
- `tests/feature-058-project-local-assignee-bridge.test.ts`
- `tests/feature-073-project-workflow-foundation.test.ts`

After deletion, verify there are no remaining references to:

- `src/lib/project-export`
- `createProjectExportResponse`
- `loadProjectExportRecords`
- `buildPreparedProjectExport`
- `PROJECT_EXPORT_`
- `/api/projects/${project.id}/export`
- `/api/projects/[projectId]/export`
- `project_export_forbidden`

Do not delete shared helpers used by release snapshots or the Media Library. The helpers imported by `src/lib/project-export/project-export.ts` from consent, matching, safe-in-filter, template fields, and HTTP error modules must remain unless separately proven unused outside this feature.

## UI/message removal plan

Update `src/app/(protected)/projects/[projectId]/page.tsx`:

- remove the export anchor from the project detail action row;
- remove the `new URLSearchParams({ workspaceId: selectedWorkspace.id })` export href construction;
- leave the section navigation in place;
- do not add a new package/download action;
- do not add Media Library guidance in this feature unless implementation reveals a small existing copy location that already points users to post-finalization output.

Current export visibility was controlled by:

- `(canOpenReviewWorkspace || canCorrectionReview) && selectedWorkspace`

Removing the link should not change project authorization, reviewer/admin/custom-role behavior, finalization state handling, or correction behavior.

Update messages:

- remove `projects.detail.exportProject` from `messages/en.json`;
- remove `projects.detail.exportProject` from `messages/nl.json`;
- do not add replacement ZIP/package copy;
- keep existing Media Library copy unchanged unless a stale ZIP/export string is found during implementation.

The implementation should check layout after removing the first flex child from the action row. Targeted verification indicates the remaining `nav` can stay inside the existing flex container.

## Test rewrite/removal plan

Delete:

- `tests/feature-043-simple-project-export-zip.test.ts`

This test file exists only to validate ZIP generation behavior and `JSZip` output parsing. It should not be rewritten because the feature is being removed.

Update `tests/feature-073-project-workflow-foundation.test.ts`:

- remove the `createProjectExportResponse` import;
- rename the test currently asserting finalization "does not block export";
- remove the assertion that finalized projects can still return an `application/zip` response;
- replace it with product-aligned finalization behavior.

Recommended replacement for Feature 073:

- keep the existing finalization/idempotency assertions;
- after finalization, assert public submission is closed by calling the existing `assertWorkspacePublicSubmissionAllowed(adminClient, tenantId, projectId, defaultWorkspaceId)` path and expecting an `HttpError` with status `409` and code `project_finalized`;
- keep release snapshot assertions if they already exist in the test or nearby tests;
- do not use ZIP export as proof that finalization succeeded.

Update `tests/feature-058-project-local-assignee-bridge.test.ts`:

- remove imports of `buildPreparedProjectExport` and `loadProjectExportRecords`;
- remove export metadata assertions from the project-recurring bridge test;
- remove export metadata assertions from the recurring whole-asset supersession test.

Recommended replacement for Feature 058:

- use the already-loaded current-model data in the tests rather than ZIP export records;
- for project-scoped recurring evidence, assert through `getAssetPreviewFaces`/preview data that the current face link points at the expected `project_recurring_consent` participant, has no one-off consent id, carries active owner/project consent state, and has the expected thumbnail metadata where already available;
- for whole-asset recurring links, assert through `loadCurrentWholeAssetLinksForAsset`, `getAssetPreviewFaces`, and candidate preview data that the whole-asset link is present before exact-face relinking, removed after supersession, and replaced by the expected exact-face current link;
- keep the tests focused on local assignee bridge behavior, not export formatting.

Keep the following release, Media Library, correction, and permission tests green:

- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-074-media-library-download.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`
- `tests/feature-077-media-library-release-helpers.test.ts`
- `tests/feature-077-media-library-ui.test.ts`
- `tests/feature-078-media-library-folders.test.ts`
- `tests/feature-078-media-library-folder-routes.test.ts`
- `tests/feature-078-media-library-ui.test.ts`
- `tests/feature-079-correction-media-intake-foundation.test.ts`
- `tests/feature-095-operational-permission-resolver-enforcement.test.ts`
- `tests/feature-096-permission-cleanup-and-effective-access-ui.test.ts`

Do not add a page-level UI regression test unless an existing lightweight project page render harness is found during implementation. Targeted verification found only component-level workflow tests, not a suitable project detail page test. Use search, TypeScript, lint, and build/test verification to prove the export link and message key are gone.

## Dependency removal plan

Remove dependencies only after route/helper/test deletion and reference verification.

Expected removals:

- remove `archiver` from `dependencies`;
- remove `jszip` from `devDependencies`;
- update `package-lock.json` through npm, not by manual lockfile editing.

Recommended command during implementation:

```powershell
npm uninstall archiver jszip
```

Then verify:

- no `archiver` import remains in `src/` or `tests/`;
- no `JSZip` or `jszip` reference remains in `src/` or `tests/`;
- `package.json` and `package-lock.json` no longer include those direct dependencies;
- no transitive lockfile entries are manually edited.

If another hidden import is found, do not remove the dependency until that import is understood and either removed as ZIP-specific or kept as a valid non-ZIP consumer.

## Documentation plan

Update `docs/rpi/SUMMARY.md`:

- add Feature 097 as the cleanup that removes the legacy Feature 043 project ZIP export;
- mark Feature 043 ZIP export as historical only;
- state that finalized output is now release snapshots and the Media Library;
- state that future DAM integration should build from release snapshots, `project_release_assets`, and stable Media Library identities;
- update or supersede Feature 096 language that describes keeping ZIP export as a restrictive legacy surface.

Update `DEPLOYMENT.md` if implementation confirms "exports" refers only to the removed ZIP export:

- remove "exports" from the service-role usage list;
- prefer wording that names the remaining server-only uses, such as uploads, workers, matching, derivatives, release snapshots, and Media Library signed downloads, if accurate in live code.

Do not update `README_APP.md` or `ARCHITECTURE.md` unless implementation finds stale ZIP/export language. Targeted verification did not find any required change in those files.

Do not write `docs/rpi/097-project-zip-export-cleanup/research.md` or create a new research document. This is implementation planning only.

## Guardrails

During implementation, preserve:

- project finalization behavior;
- release snapshot creation;
- release snapshot immutability assumptions;
- Media Library list/detail/download behavior;
- Media Library folder behavior;
- release safety context;
- correction and re-release behavior;
- public token flows;
- operational permission resolver behavior;
- effective access UI behavior;
- tenant scoping and server-derived authorization.

Do not remove:

- release snapshot services;
- Media Library download helpers;
- storage helpers shared by Media Library;
- matching or consent helpers used outside ZIP export;
- permission resolver helpers unless a separate plan explicitly scopes that cleanup.

## Security considerations

Removing ZIP export should reduce attack surface:

- no mutable project-data export endpoint remains;
- no ZIP streaming path remains;
- no old reviewer/correction export path remains;
- no service-role-backed export path remains;
- no project/workspace custom-role export grant is introduced.

The implementation must not:

- expand Media Library access;
- change project or workspace role resolution;
- add a replacement export endpoint;
- expose service-role behavior to the client;
- accept tenant or workspace authorization from client input;
- change public token behavior;
- mutate release snapshots differently.

## Edge cases

Stale internal route references:

- deleting the route should make stale imports or route references fail through search, TypeScript, lint, tests, or build.

Bookmarked local development URLs:

- with Option A, `GET /api/projects/[projectId]/export` returns the framework's missing-route behavior after deletion;
- this is acceptable because the app is not in production and external compatibility is not required.

Stale tests importing deleted helpers:

- known imports are in Feature 043, Feature 058, and Feature 073 tests;
- search must prove no `src/lib/project-export` imports remain.

Dependency removal:

- if `archiver` or `jszip` appears in any non-ZIP path, stop and classify that usage before removing the dependency.

Project page layout:

- removing the export anchor leaves the existing section navigation in the action row;
- do not add new UI copy unless necessary to keep layout coherent.

Documentation:

- historical RPI documents can keep their original detailed contents, but `SUMMARY.md` must clearly identify ZIP export as removed by Feature 097.

Correction/re-release tests:

- targeted verification did not find direct ZIP export imports in correction or Media Library tests;
- still run the correction/re-release tests because removal must not disturb release replacement behavior.

## Implementation phases

1. Remove UI export link and messages.
   - Edit `src/app/(protected)/projects/[projectId]/page.tsx`.
   - Remove `projects.detail.exportProject` from `messages/en.json` and `messages/nl.json`.
   - Search for stale `exportProject` usage.

2. Remove route and project-export helpers.
   - Delete `src/app/api/projects/[projectId]/export/route.ts`.
   - Delete `src/lib/project-export/project-export.ts`.
   - Delete `src/lib/project-export/response.ts`.
   - Delete `src/lib/project-export/naming.ts`.
   - Remove the directory if empty.

3. Rewrite/remove tests.
   - Delete `tests/feature-043-simple-project-export-zip.test.ts`.
   - Rewrite the Feature 073 finalization test to assert finalization/idempotency/public submission closure instead of ZIP availability.
   - Rewrite Feature 058 export-metadata assertions to direct current-model assertions.

4. Remove unused dependencies.
   - Verify no `archiver`, `JSZip`, or `jszip` imports remain.
   - Run `npm uninstall archiver jszip`.
   - Verify `package.json` and `package-lock.json`.

5. Update docs.
   - Update `docs/rpi/SUMMARY.md`.
   - Update `DEPLOYMENT.md` if "exports" is only the removed ZIP export.
   - Leave `README_APP.md` and `ARCHITECTURE.md` unchanged unless stale references are found during implementation.

6. Run targeted and broad verification.
   - Run searches.
   - Run targeted tests.
   - Run lint.
   - Run full tests if practical.
   - Run build if route/dependency deletion produces compile-risk questions not covered by lint/tests.

## Verification commands

Use PowerShell search commands because `rg` was not available during planning verification.

Reference cleanup:

```powershell
Get-ChildItem -Path src,tests -Recurse -File |
  Select-String -Pattern 'project-export','createProjectExportResponse','loadProjectExportRecords','buildPreparedProjectExport','PROJECT_EXPORT','archiver','JSZip','jszip'
```

Route/UI/copy cleanup:

```powershell
Get-ChildItem -Path src,tests,docs -Recurse -File |
  Select-String -Pattern '/api/projects/.*/export','exportProject','project_export_forbidden'
```

Dependency verification:

```powershell
Select-String -Path package.json,package-lock.json -Pattern 'archiver','jszip','zip-stream'
```

Targeted tests:

```powershell
npm test -- tests/feature-058-project-local-assignee-bridge.test.ts tests/feature-073-project-workflow-foundation.test.ts tests/feature-074-project-release-media-library.test.ts tests/feature-074-media-library-download.test.ts tests/feature-075-project-correction-workflow.test.ts tests/feature-077-media-library-release-helpers.test.ts tests/feature-077-media-library-ui.test.ts tests/feature-078-media-library-folders.test.ts tests/feature-078-media-library-folder-routes.test.ts tests/feature-078-media-library-ui.test.ts tests/feature-079-correction-media-intake-foundation.test.ts tests/feature-095-operational-permission-resolver-enforcement.test.ts tests/feature-096-permission-cleanup-and-effective-access-ui.test.ts
```

Lint:

```powershell
npm run lint
```

Full test suite, if practical:

```powershell
npm test
```

Optional compile verification if targeted tests and lint do not cover route/dependency deletion enough:

```powershell
npm run build
```

## Scope boundaries

In scope:

- delete ZIP export route;
- delete ZIP export helpers;
- remove project page ZIP export action;
- remove ZIP export message keys;
- remove ZIP tests;
- rewrite non-ZIP tests that used ZIP helpers as an assertion shortcut;
- remove direct ZIP dependencies after verification;
- update docs describing supported delivery paths.

Out of scope:

- Media Library bulk download;
- any new export/package feature;
- DAM integration implementation;
- project finalization changes;
- release snapshot schema or service changes;
- Media Library auth or download changes;
- correction/re-release changes;
- public token changes;
- permission model changes;
- broad cleanup of legacy permission helpers.

## Concise implementation prompt

Implement Feature 097 by deleting the legacy project ZIP export path. Remove the project detail export link and `projects.detail.exportProject` messages, delete `GET /api/projects/[projectId]/export`, delete `src/lib/project-export/` after removing references, delete the Feature 043 ZIP export test, rewrite Feature 073 and Feature 058 tests so they assert finalization/current-model behavior without project-export helpers, remove `archiver` and `jszip` only after import searches prove they are unused, and update `docs/rpi/SUMMARY.md` plus `DEPLOYMENT.md` where stale export wording remains. Do not change finalization, release snapshot creation, Media Library behavior, correction/re-release behavior, public token flows, or permission semantics. Verify with reference searches, the targeted release/Media Library/correction/permission tests, lint, and full tests if practical.
