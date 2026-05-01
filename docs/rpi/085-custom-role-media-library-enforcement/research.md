# Feature 085 - Custom role enforcement for Media Library access research

## 1. Title and scope

Feature 085 is the first bounded custom-role enforcement slice. It should make active tenant-scoped custom role assignments affect Media Library authorization only.

In scope for research:

- Media Library list, detail, download, and folder-management authorization.
- Tenant-scoped custom role assignments from Feature 084.
- `media_library.access` and `media_library.manage_folders` capabilities.
- TypeScript and SQL/RLS parity.
- Tests for access, denial, revoked assignments, archived roles, tenant isolation, and non-expansion outside Media Library.

Out of scope:

- Generic effective capability engine.
- Custom role enforcement for projects, workspaces, capture, review, correction, finalization, profiles, templates, members, or invites.
- Project-scoped or workspace-scoped Media Library filtering.
- Folder or asset-specific permissions.
- Release snapshot or folder data model changes.

Current live code and migrations are authoritative. Prior RPI documents were used only as context.

## 2. Inputs reviewed

Required documents reviewed:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/plan.md`
- `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/plan.md`
- `docs/rpi/083-custom-role-editor-foundation/plan.md`
- `docs/rpi/084-custom-role-assignment-foundation/plan.md`

Live code and schema inspected:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/role-assignment-foundation.ts`
- `src/lib/tenant/custom-role-service.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/project-releases/media-library-download.ts`
- `src/lib/media-library/media-library-folder-service.ts`
- `src/lib/media-library/media-library-folder-route-handlers.ts`
- `src/app/(protected)/layout.tsx`
- `src/components/navigation/protected-nav.tsx`
- `src/components/media-library/media-library-folder-browser.tsx`
- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- `src/app/api/media-library/**`
- `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
- `supabase/migrations/20260425120000_078_media_library_folders_foundation.sql`
- `supabase/migrations/20260430120000_081_role_assignment_foundation.sql`
- `supabase/migrations/20260430130000_082_reviewer_access_assignment_enforcement.sql`
- `supabase/migrations/20260430140000_083_custom_role_editor_functions.sql`
- Relevant tests for Features 074, 078, 081, 082, 083, and 084.

## 3. Verified current Media Library authorization

### Navigation

Protected layout resolves active tenant permissions with `resolveTenantPermissions(...)` and sets `showMediaLibrary = permissions.canReviewProjects` in `src/app/(protected)/layout.tsx`. `ProtectedNav` hides `/media-library` unless `showMediaLibrary` is true.

After Feature 082, `canReviewProjects` is tenant-wide effective review access. Therefore nav currently shows Media Library for:

- owner/admin, by fixed role
- reviewer with active tenant-wide system reviewer assignment

Nav currently does not show Media Library for:

- photographer
- unassigned fixed reviewer
- project-scoped reviewer without tenant-wide reviewer assignment
- member with a custom role assignment containing `media_library.access`, because custom roles are not enforced yet

### `/media-library` page

The page resolves auth and tenant, then calls `getMediaLibraryPageData(...)`. That calls `listMediaLibraryAssets(...)`, which calls `authorizeMediaLibraryAccess(...)` before loading published release assets.

`authorizeMediaLibraryAccess(...)` currently allows only:

- `permissions.role === "owner"`
- `permissions.role === "admin"`
- `permissions.hasTenantWideReviewAccess`

It denies everyone else with `media_library_forbidden`.

Folder rows are loaded in `getMediaLibraryPageData(...)` after the asset access check. Folder RLS also protects those reads.

### `/media-library/[releaseAssetId]` detail page

The detail page resolves auth and tenant, then calls `getReleaseAssetDetail(...)`. That function calls `authorizeMediaLibraryAccess(...)`, loads the release asset by `tenant_id` and `id`, and separately verifies its release is still `published`.

If a `folderId` query param is present, the detail page calls `getActiveMediaLibraryFolder(...)` only to build a safe back link. That folder helper also calls `authorizeMediaLibraryAccess(...)`.

### Release asset download

`GET /api/media-library/assets/[releaseAssetId]/download` calls `createMediaLibraryAssetDownloadResponse(...)`.

The download flow:

- requires an authenticated Supabase user
- derives tenant through `resolveTenantId(...)`
- calls `getReleaseAssetDetail(...)`, which enforces `authorizeMediaLibraryAccess(...)`
- uses an admin storage client only after authorization to create a 120-second signed URL

This is TypeScript-first authorization backed by release-asset RLS on any authenticated reads inside `getReleaseAssetDetail(...)`.

### Folder list/read

`listActiveMediaLibraryFolders(...)` and `getActiveMediaLibraryFolder(...)` both call `authorizeMediaLibraryAccess(...)`.

SQL/RLS also allows folder selects when `app.current_user_can_access_media_library(tenant_id)` returns true.

### Folder create/rename/archive

`createMediaLibraryFolder(...)`, `renameMediaLibraryFolder(...)`, and `archiveMediaLibraryFolder(...)` all call `authorizeMediaLibraryAccess(...)` today. There is no TypeScript distinction between Media Library read access and folder management.

SQL/RLS uses `app.current_user_can_manage_media_library(tenant_id)` for insert/update/delete on `media_library_folders`.

### Folder add/move/remove asset operations

`addMediaLibraryAssetsToFolder(...)`, `moveMediaLibraryAssetsToFolder(...)`, and `removeMediaLibraryAssetsFromFolder(...)` all call `authorizeMediaLibraryAccess(...)` today. There is no separate TypeScript folder-management capability check.

The service validates tenant-scoped stable Media Library asset IDs through `media_library_assets`, validates active folders, and uses idempotent or conditional writes:

- add uses upsert with `ignoreDuplicates` and re-reads to detect concurrent assignment to another folder
- move inserts missing memberships then updates only rows not already in the target folder
- remove deletes only matching memberships for the requested folder

SQL/RLS uses `app.current_user_can_manage_media_library(tenant_id)` for insert/update/delete on `media_library_folder_memberships`.

### Current owner/admin/reviewer assumptions

TypeScript currently treats owner/admin as fixed-role Media Library users and tenant-wide system-reviewer assignment as equivalent to the old reviewer behavior. SQL helper migration 082 mirrors this:

- `app.current_user_can_access_media_library(p_tenant_id)` allows owner/admin fixed roles or `app.current_user_has_tenant_wide_reviewer_access(p_tenant_id)`.
- `app.current_user_can_manage_media_library(p_tenant_id)` has the same rule.

Feature 082 intentionally denies project-scoped reviewer assignment for tenant-wide Media Library access.

## 4. Verified current custom role assignment foundation

### Capability catalog

`TENANT_CAPABILITIES` includes:

- `media_library.access`
- `media_library.manage_folders`

`ROLE_CAPABILITIES` maps owner/admin to every capability and reviewer to both Media Library capabilities. Photographer has no Media Library capability.

These role capability mappings are metadata for fixed/system role display and drift tests. They are not a generic effective-capability enforcement engine.

### Role definition tables

Feature 081 added:

- `capabilities`
- `role_definitions`
- `role_definition_capabilities`
- `role_assignments`

System roles have `is_system = true`, `tenant_id is null`, and `system_role_key` in `owner`, `admin`, `reviewer`, `photographer`.

Tenant custom roles have `is_system = false`, `tenant_id is not null`, null `system_role_key`, and actor audit fields. Archived custom roles keep their capability mappings.

### Assignment shape

Feature 084 assigns custom roles through `role_assignments` with:

- `scope_type = 'tenant'`
- `project_id is null`
- `workspace_id is null`
- `revoked_at is null` for active rows
- tenant custom role definitions only

Multiple active custom roles per member are allowed. Duplicate active assignment for the exact same tenant/user/role is idempotent in the service and prevented by the partial unique index.

Revocation sets `revoked_at` and `revoked_by`. Re-adding after revoke creates a new row.

Member removal cascades role assignments through the `(tenant_id, user_id)` membership foreign key.

### Archived role behavior

Feature 084 does not assign archived roles. It does not auto-revoke existing assignments when a custom role is archived. Active assignments to archived roles can remain visible and revokable in management UI.

Therefore Feature 085 enforcement must explicitly ignore archived custom roles even if an active assignment row still exists.

### Existing non-enforcement tests

Feature 083 and 084 tests explicitly assert custom roles do not currently grant review or Media Library access. Feature 085 should replace only the Media Library portion of those expectations and keep all other non-enforcement assertions intact.

### Safest helper seam

The safest seam is a new narrow Media Library-specific resolver in `src/lib/tenant/`, not `permissions.ts` and not a generic app-wide capability engine.

Recommended helper responsibility:

- Given server-resolved `tenantId` and authenticated `userId`, answer whether the user has an active tenant-scoped custom role assignment with a specific Media Library capability.
- Require a current tenant membership.
- Require `role_definitions.is_system = false`.
- Require `role_definitions.tenant_id = tenantId`.
- Require `role_definitions.archived_at is null`.
- Require `role_assignments.scope_type = 'tenant'`.
- Require `role_assignments.project_id is null`.
- Require `role_assignments.workspace_id is null`.
- Require `role_assignments.revoked_at is null`.
- Require a matching `role_definition_capabilities.capability_key`.

This can reuse query patterns from `custom-role-assignment-service.ts` but should not import manager-only assignment service functions into runtime authorization.

## 5. Options considered for enforcement model

### Option A - Media Library-specific custom-role resolver

Add a narrow resolver for:

- has custom role with `media_library.access`
- has custom role with `media_library.manage_folders`

Implementation size: small. It only touches the Media Library TypeScript helpers and SQL helper functions.

Security: strong if it requires active membership, tenant-scope assignment, non-archived tenant custom role, active assignment, and exact capability mapping.

SQL/RLS parity: straightforward because SQL helpers can use matching `exists` predicates.

Future enforcement: does not block a later generic capability engine. It creates a concrete tested pattern.

Risk of broad authorization changes: low, because it is not imported into project/review/capture/member permission paths.

### Option B - Generic tenant effective capability resolver

Build an effective capability resolver for all tenant-scoped custom role capabilities, but use it only for Media Library in this feature.

Implementation size: larger. It would need careful API semantics around system roles, custom roles, scope types, archived roles, revoked rows, and possibly project/workspace scope.

Security: can be strong, but broader abstractions are easier to accidentally reuse for unrelated areas before they are designed.

SQL/RLS parity: harder. A generic TS resolver would not automatically solve SQL helper parity, and a generic SQL function would need careful scope semantics.

Future enforcement: useful later, but premature for this bounded slice.

Risk of broad authorization changes: medium to high. It invites accidental imports into non-Media-Library areas.

### Option C - SQL-only enforcement

Update SQL/RLS helpers but leave TypeScript mostly unchanged.

Implementation size: small.

Security: incomplete. RLS would allow direct table reads/writes for custom-role users, but pages and routes would still call `authorizeMediaLibraryAccess(...)` and deny them before useful app behavior works.

SQL/RLS parity: poor because TS and SQL would intentionally diverge.

Future enforcement: creates confusing tests and debugging.

Risk of broad authorization changes: low outside Media Library, but high risk of broken Media Library UX.

### Option D - TypeScript-only enforcement

Update `authorizeMediaLibraryAccess(...)` and folder services, but do not change SQL/RLS helpers.

Implementation size: small.

Security: insufficient. App routes may work only when using service-role paths, but authenticated Supabase queries to RLS-protected Media Library tables would still be denied. Worse, TypeScript may think a folder write is authorized while RLS blocks it.

SQL/RLS parity: poor.

Future enforcement: leaves a known access-control split.

Risk of broad authorization changes: low outside Media Library, but high operational risk inside Media Library.

### Recommendation

Use Option A. Add a Media Library-specific resolver now and update both TypeScript and SQL/RLS helpers.

Avoid Option B in Feature 085. A generic engine should wait until more areas have been researched and can define scope semantics consistently.

Reject Option C and Option D because this app relies on both server-side TypeScript authorization and RLS as a backstop.

## 6. Recommended Media Library custom-role enforcement model

Effective Media Library access should be true when any of these is true:

- current user is an active tenant member with fixed role `owner`
- current user is an active tenant member with fixed role `admin`
- current user is a fixed `reviewer` with active tenant-wide system reviewer assignment from Feature 082
- current user is an active tenant member with an active tenant-scoped custom role assignment whose active tenant custom role has `media_library.access`

Effective Media Library folder management should be true when any of these is true:

- current user is an active tenant member with fixed role `owner`
- current user is an active tenant member with fixed role `admin`
- current user is a fixed `reviewer` with active tenant-wide system reviewer assignment from Feature 082
- current user is an active tenant member with an active tenant-scoped custom role assignment whose active tenant custom role has `media_library.manage_folders`

Do not use project-scoped or workspace-scoped custom role assignments for Media Library in Feature 085.

Do not require fixed role `reviewer` for custom role enforcement. Feature 084 allows assigning custom roles to any member, and Feature 085 should let a `member` with any fixed role gain only the explicit Media Library slice granted by the custom role.

The implementation should not call custom role assignment management service functions for enforcement. It should use a small read helper dedicated to authorization.

## 7. Capability semantics recommendation

Recommended semantics:

- `media_library.access` grants Media Library list, detail, and download.
- `media_library.manage_folders` grants folder create, rename, archive, add asset, move asset, and remove asset operations.
- `media_library.manage_folders` should imply the read/access needed to complete folder operations, even if the role does not also contain `media_library.access`.
- The `/media-library` page and release asset detail/download should require `media_library.access`, owner/admin, or tenant-wide system reviewer access. Do not treat `media_library.manage_folders` alone as page-level browse/download access in this slice.

Reasoning:

- Folder operations necessarily need to read folders and stable asset identities to validate the mutation safely.
- Page browsing/downloading is a separate user-facing capability from folder curation.
- Keeping page access tied to `media_library.access` makes the catalog labels accurate and avoids granting download rights from a management-only role.
- The custom role editor can later warn that `media_library.manage_folders` is usually paired with `media_library.access`, but enforcement should remain robust if a manager creates a management-only role.

Implementation consequence:

- Add separate TS authorizers, for example `authorizeMediaLibraryAccess(...)` and `authorizeMediaLibraryFolderManagement(...)`.
- Folder mutation services should call the folder-management authorizer.
- Folder list/read operations used as part of page browsing should still call access authorization.
- Folder validation reads inside mutation paths can be internal after `authorizeMediaLibraryFolderManagement(...)`.

Open semantic point for plan phase:

- If product wants a folder manager to see the Media Library page so they can select assets, then `media_library.manage_folders` should also set a UI-specific `canAccessMediaLibraryPage`. The default recommendation is not to do that unless the product wants management-only roles to browse/download.

## 8. SQL/RLS migration recommendation

Add one migration for Feature 085. It should update existing helper functions rather than rewrite table policies.

Recommended new app helper:

- `app.current_user_has_tenant_custom_role_capability(p_tenant_id uuid, p_capability_key text)`

This helper should be narrow in behavior even if the function name is capability-shaped. It should be used only by Media Library helpers in Feature 085.

Required SQL predicate:

```sql
exists (
  select 1
  from public.memberships m
  join public.role_assignments ra
    on ra.tenant_id = m.tenant_id
   and ra.user_id = m.user_id
  join public.role_definitions rd
    on rd.id = ra.role_definition_id
  join public.role_definition_capabilities rdc
    on rdc.role_definition_id = rd.id
  where m.tenant_id = p_tenant_id
    and m.user_id = auth.uid()
    and ra.tenant_id = p_tenant_id
    and ra.user_id = auth.uid()
    and ra.scope_type = 'tenant'
    and ra.project_id is null
    and ra.workspace_id is null
    and ra.revoked_at is null
    and rd.is_system = false
    and rd.tenant_id = p_tenant_id
    and rd.archived_at is null
    and rdc.capability_key = p_capability_key
)
```

Then update:

- `app.current_user_can_access_media_library(p_tenant_id)`
- `app.current_user_can_manage_media_library(p_tenant_id)`
- public wrappers if present

Access helper should allow:

- owner/admin fixed roles
- tenant-wide system reviewer assignment
- custom role capability `media_library.access`

Manage helper should allow:

- owner/admin fixed roles
- tenant-wide system reviewer assignment
- custom role capability `media_library.manage_folders`

Do not update project/workspace/review/capture helpers.

RLS policies on `project_releases`, `project_release_assets`, `media_library_assets`, `media_library_folders`, and `media_library_folder_memberships` can continue calling the same `app.current_user_can_access_media_library` and `app.current_user_can_manage_media_library` functions. Updating those functions is enough for RLS parity.

Grant execute to `authenticated` only if tests or app code need direct RPC access. Revoke from `public`, matching existing migrations.

## 9. TypeScript helper recommendation

Add a new narrow module, for example:

- `src/lib/tenant/media-library-custom-role-access.ts`

Recommended exports:

- `userHasTenantCustomRoleCapability(...)`
- `resolveMediaLibraryAccess(...)`
- `authorizeMediaLibraryAccess(...)` can remain in `project-release-service.ts` or delegate to the new resolver.
- `authorizeMediaLibraryFolderManagement(...)`

Recommended `resolveMediaLibraryAccess(...)` output:

```ts
type MediaLibraryAccessResolution = {
  canAccess: boolean;
  canManageFolders: boolean;
  source: "owner_admin" | "tenant_reviewer" | "custom_role" | "none";
};
```

The helper should:

- require server-resolved tenant id
- validate current membership through `memberships`
- reuse `resolveTenantPermissions(...)` only for owner/admin and tenant-wide reviewer behavior, or query membership directly to avoid unrelated permission fields
- use a service-role client for custom role assignment reads after membership validation if authenticated RLS is too narrow for non-manager users to read role definitions and capability mappings
- never trust client-provided tenant id
- ignore revoked assignments and archived roles
- ignore system roles
- ignore project/workspace scoped assignments

Recommended call-site changes:

- Keep `listMediaLibraryAssets(...)`, `getMediaLibraryPageData(...)`, and `getReleaseAssetDetail(...)` behind `authorizeMediaLibraryAccess(...)`.
- Change folder management operations in `media-library-folder-service.ts` to call `authorizeMediaLibraryFolderManagement(...)`.
- Keep folder list/read behind `authorizeMediaLibraryAccess(...)` unless used internally by mutation helpers after management authorization.
- Do not import the new custom-role resolver into `permissions.ts` for general tenant permissions in this feature.

## 10. UI/nav recommendation

Current nav relies on `permissions.canReviewProjects`, which is effectively tenant-wide review access after Feature 082. That will not show Media Library for a member who only has custom role `media_library.access`.

Feature 085 should minimally update layout/nav gating to use a Media Library-specific flag:

- Resolve `canShowMediaLibraryNav` with the same effective Media Library access semantics as `authorizeMediaLibraryAccess(...)`.
- Do not use `permissions.canReviewProjects` as a proxy for Media Library visibility after custom-role enforcement.

Folder-management UI currently renders for every Media Library page user:

- create folder form
- rename/archive buttons
- asset selection checkboxes
- add/move/remove controls

Feature 085 should hide or disable folder-management UI unless the user has effective folder management:

- owner/admin
- tenant-wide system reviewer assignment
- custom role with `media_library.manage_folders`

Users with only `media_library.access` should still browse, view detail, and download, but not see folder mutation controls.

Recommended page data change:

- Have `getMediaLibraryPageData(...)` or a sibling resolver return `canManageFolders`.
- Pass `canManageFolders` into `MediaLibraryFolderBrowser`.
- Render folder controls conditionally.

Keep UI copy minimal. No new dashboard or access-management page is needed.

## 11. Security and tenant-isolation risks

Risk: custom role assignment from another tenant grants access.

- Mitigation: every resolver joins `role_definitions.tenant_id = p_tenant_id` and `role_assignments.tenant_id = p_tenant_id`.

Risk: stale active assignment to an archived custom role grants access.

- Mitigation: every resolver requires `role_definitions.archived_at is null`.

Risk: revoked assignment grants access.

- Mitigation: every resolver requires `role_assignments.revoked_at is null`.

Risk: project/workspace custom role assignment accidentally grants tenant-wide Media Library access.

- Mitigation: every resolver requires tenant scope plus null project/workspace ids.

Risk: user is no longer a tenant member but keeps an assignment row.

- Mitigation: membership FK cascades on removal, but helpers should still join `memberships` and require `m.user_id = auth.uid()`/`userId`.

Risk: TS and SQL helpers disagree.

- Mitigation: add parity tests for access/manage helpers and folder RLS.

Risk: custom role Media Library capabilities accidentally grant project/review/capture/member permissions.

- Mitigation: do not import the resolver into `permissions.ts` or project/workspace helpers. Keep non-enforcement regression tests for other capabilities.

Risk: `media_library.manage_folders` without `media_library.access` creates confusing UI.

- Mitigation: enforcement should allow folder operations through the API while the page remains access-gated. Plan phase should decide whether UI should warn later or whether page nav should include manage-only users.

Risk: direct table access differs from route behavior.

- Mitigation: update both SQL helpers and TypeScript authorizers in the same feature.

## 12. Fresh reset and seed/dev data considerations

Assume local development can use:

```bash
supabase db reset
```

Do not preserve, repair, or backfill arbitrary old local custom-role assignment rows.

Tests should create:

- the custom role definitions they need
- capability mappings through the existing custom role service or direct setup helpers
- tenant-scoped custom role assignments through Feature 084 service or controlled admin fixtures
- reviewer tenant/project assignments explicitly where needed

No seed custom roles or custom role assignments are required for Feature 085.

Archived role tests should create a role, assign it, then archive it. The enforcement test should prove the still-active assignment no longer grants access.

Revocation tests should revoke the assignment by setting `revoked_at`/`revoked_by` through the service and verify both TS and SQL deny access.

## 13. Testing recommendations

Add a focused test file, likely:

- `tests/feature-085-custom-role-media-library-enforcement.test.ts`

Recommended tests:

- owner/admin still access Media Library list/detail/download.
- owner/admin still manage folders.
- tenant-wide system reviewer assignment still accesses and manages Media Library.
- project-scoped reviewer assignment alone is denied tenant-wide Media Library access.
- custom role with `media_library.access` allows list/detail/download.
- custom role with `media_library.access` does not allow folder management.
- custom role with `media_library.manage_folders` allows create/rename/archive/add/move/remove folder operations.
- custom role with only `media_library.manage_folders` does not allow list/detail/download unless the plan intentionally changes page semantics.
- custom role with no Media Library capabilities is denied.
- revoked custom role assignment is denied.
- archived custom role is denied even if assignment remains active.
- assignment in another tenant does not grant access.
- project-scoped or workspace-scoped custom role assignment does not grant Media Library access.
- SQL `current_user_can_access_media_library` and TypeScript access resolver agree.
- SQL `current_user_can_manage_media_library` and TypeScript folder-management resolver agree.
- RLS permits folder selects for access-capable users.
- RLS permits folder and membership writes for manage-capable users.
- RLS denies folder writes for access-only users.
- custom role Media Library enforcement does not grant review/capture/project/member access.
- `supabase db reset` plus tests creates all custom roles and assignments explicitly.

Existing tests to update:

- Feature 083 and 084 non-enforcement tests should keep review/capture/member/project denial, but update Media Library expectations for custom roles only where the test intentionally assigns `media_library.access`.
- Feature 078 folder tests may need role fixtures expanded if folder management no longer follows simple Media Library access.
- Feature 082 tests should keep tenant-wide reviewer allowed and project-scoped reviewer denied for Media Library.

## 14. Open questions for plan phase

1. Should a user with only `media_library.manage_folders` see the Media Library nav/page so they can operate through the normal UI, or should folder-management capability be API-effective only unless paired with `media_library.access`?
2. Should `resolveMediaLibraryAccess(...)` use a service-role client for all custom-role capability reads, or can authenticated own-assignment reads plus a limited new RLS policy safely support non-manager capability reads?
3. Should the SQL helper be named generically (`current_user_has_tenant_custom_role_capability`) or Media Library-specific (`current_user_has_media_library_custom_role_capability`) to reduce future misuse?
4. Should folder read helpers split into public page reads versus mutation-internal reads to keep `media_library.manage_folders` from implying general folder browsing?
5. Should the custom role editor later warn when `media_library.manage_folders` is selected without `media_library.access`?

## 15. Summary recommendation

Feature 085 should implement a narrow Media Library custom-role enforcement slice:

- Add a Media Library-specific custom role capability resolver.
- Update `authorizeMediaLibraryAccess(...)` for `media_library.access`.
- Add folder-management authorization for `media_library.manage_folders`.
- Update SQL helpers and existing RLS-backed policies through function replacement.
- Update nav visibility to use effective Media Library access instead of review permission.
- Hide folder-management UI for access-only users.
- Keep project, review, capture, correction, finalization, template, profile, and member authorization unchanged.

