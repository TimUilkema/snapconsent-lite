# Feature 085 - Custom role enforcement for Media Library access plan

## 1. Scope and contract

Feature 085 is the first bounded custom-role enforcement slice. It will make active tenant-scoped custom role assignments affect only Media Library authorization:

- `media_library.access`
- `media_library.manage_folders`

The feature must not introduce a generic effective capability engine, and it must not enforce custom roles for projects, workspaces, capture, review, correction, finalization, templates, profiles, members, invites, or any other app area.

Locked decisions:

- use tenant-scoped custom role assignments only
- ignore project-scoped and workspace-scoped custom role assignments
- ignore revoked assignments
- ignore archived custom roles
- do not require fixed `reviewer` role for custom-role Media Library access
- keep owner/admin fixed-role Media Library access
- keep Feature 082 tenant-wide system reviewer assignment access
- keep Feature 082 project-scoped reviewer assignment denied for tenant-wide Media Library
- update both TypeScript authorization and SQL/RLS helpers
- do not introduce a generic effective capability engine

## 2. Inputs and ground truth

Read in the requested order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `UNCODEXIFY.md`
5. `docs/rpi/README.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/plan.md`
8. `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/plan.md`
9. `docs/rpi/083-custom-role-editor-foundation/plan.md`
10. `docs/rpi/084-custom-role-assignment-foundation/plan.md`
11. `docs/rpi/074-project-release-package-and-media-library-placeholder/research.md`
12. `docs/rpi/074-project-release-package-and-media-library-placeholder/plan.md`
13. `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/research.md`
14. `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/plan.md`
15. `docs/rpi/078-organization-scoped-media-library-folders-and-organization-foundation/research.md`
16. `docs/rpi/078-organization-scoped-media-library-folders-and-organization-foundation/plan.md`
17. `docs/rpi/075-project-correction-and-re-release-foundation/plan.md`
18. `docs/rpi/079-project-correction-media-intake-and-release-asset-additions/plan.md`
19. `docs/rpi/085-custom-role-media-library-enforcement/research.md`

Targeted live verification covered the requested tenant role files, Media Library release and download helpers, folder service and route handlers, protected nav/layout, Media Library pages and folder browser, current API route files, migrations, and relevant Feature 074, 077, 078, 081, 082, 083, and 084 tests.

Ground truth:

- current live code and migrations are authoritative
- prior RPI docs are context only
- Feature 074, 077, and 078 docs reveal no plan-changing drift, but they add important invariants around immutable release snapshots, latest-release list behavior, historical detail access, safety context, and stable folder identity

## 3. Verified current Media Library boundary

Current access boundary:

- protected nav: `src/app/(protected)/layout.tsx` sets `showMediaLibrary = permissions.canReviewProjects`
- nav rendering: `src/components/navigation/protected-nav.tsx` hides `/media-library` unless `showMediaLibrary`
- list page: `src/app/(protected)/media-library/page.tsx` resolves auth and tenant, then calls `getMediaLibraryPageData(...)`
- detail page: `src/app/(protected)/media-library/[releaseAssetId]/page.tsx` calls `getReleaseAssetDetail(...)`
- download route: `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts` delegates to `createMediaLibraryAssetDownloadResponse(...)`
- release-table RLS: `project_releases` and `project_release_assets` select policies call `app.current_user_can_access_media_library(tenant_id)`
- folder reads: folder select policies call `app.current_user_can_access_media_library(tenant_id)`
- folder writes: folder and membership write policies call `app.current_user_can_manage_media_library(tenant_id)`
- folder service: all folder list/read/write helpers currently call `authorizeMediaLibraryAccess(...)`

Current behavior:

- owner/admin fixed roles can access and manage Media Library
- fixed reviewer only gets tenant-wide Media Library when Feature 082 tenant-wide reviewer assignment exists
- project-scoped reviewer assignment can review assigned project workspaces but is denied tenant-wide Media Library
- photographers are denied
- custom role assignments do not currently grant live Media Library access

Media Library and release invariants to preserve:

- list shows current/latest published release assets, including Feature 078 folder filtering over stable `media_library_assets`
- direct detail by immutable `project_release_assets.id` remains valid for historical published releases
- download still authorizes through release-asset detail and signs storage server-side
- Feature 077 blocked/restricted/manual safety context remains snapshot-derived and read-only
- Feature 077 download confirmation remains UI-advisory only; route authorization remains the security boundary
- folder mutations never mutate `project_releases`, `project_release_assets`, source assets, review state, correction state, or finalization state
- stable folder identity remains `(tenant_id, project_id, source_asset_id)` via `media_library_assets`

Feature 085 changes only who can pass Media Library access and folder-management authorization. It does not change release, snapshot, correction, download, warning, or folder data semantics.

## 4. Recommendation

Use a narrow Media Library-specific custom-role resolver and update both TypeScript and SQL/RLS helper functions.

Do not add a generic tenant effective capability resolver. Do not route Media Library custom-role checks through `resolveTenantPermissions(...)` as a new general permission field. The new resolver should be imported only by Media Library authorization call sites and protected layout/nav gating.

## 5. Chosen enforcement architecture

Add a bounded helper module:

- `src/lib/tenant/media-library-custom-role-access.ts`

Recommended exports:

- `userHasMediaLibraryCustomRoleCapability(...)`
- `resolveMediaLibraryAccess(...)`
- `authorizeMediaLibraryAccess(...)`
- `authorizeMediaLibraryFolderManagement(...)`

The module should:

- require server-resolved `tenantId`
- require authenticated `userId`
- validate current tenant membership first
- preserve fixed owner/admin behavior
- preserve Feature 082 tenant-wide system reviewer behavior
- check custom roles only after membership validation
- use service-role reads for custom role capability checks if authenticated RLS cannot expose tenant custom role definitions and capability mappings to non-manager assignees
- ignore revoked assignments
- ignore archived role definitions
- ignore system role definitions
- ignore project/workspace custom role assignments

Keep existing project/review/capture/correction helpers unchanged.

## 6. Exact capability semantics

Locked semantics:

- `media_library.access` grants Media Library nav visibility, list page, release asset detail, and release asset download.
- `media_library.manage_folders` grants folder create, rename, archive, add asset, move asset, and remove asset operations.
- `media_library.manage_folders` does not imply list/detail/download access in Feature 085.
- A user with only `media_library.manage_folders` is API/RLS-capable for folder mutations but does not see Media Library nav/page and cannot list/detail/download release assets.
- A practical folder manager who uses the current UI should be assigned both `media_library.access` and `media_library.manage_folders`.
- Access-only users can browse, view detail, and download, but cannot mutate folders.

Reasoning:

- current UI cannot cleanly support manage-without-browse without a larger partial Media Library shell
- download is a distinct capability from folder curation
- folder operations still need their own direct authorization so API calls and RLS cannot be bypassed by hiding UI
- a later custom role editor warning can recommend pairing `manage_folders` with `access`

## 7. Exact SQL/RLS helper plan

Add one migration for Feature 085. It should replace helper functions, not table structure or policies.

Prefer a Media Library-specific helper name to discourage broader reuse:

- `app.current_user_has_media_library_custom_role_capability(p_tenant_id uuid, p_capability_key text)`

The helper should return false unless `p_capability_key` is one of:

- `media_library.access`
- `media_library.manage_folders`

Required predicate:

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

Update:

- `app.current_user_can_access_media_library(p_tenant_id)`
- `app.current_user_can_manage_media_library(p_tenant_id)`
- existing public wrappers that delegate to those helpers

Final SQL behavior:

- access helper allows owner/admin fixed roles, tenant-wide system reviewer assignment, or custom role `media_library.access`
- manage helper allows owner/admin fixed roles, tenant-wide system reviewer assignment, or custom role `media_library.manage_folders`
- project-scoped reviewer assignment remains denied
- project/workspace custom role assignments remain ignored

Do not update project/workspace/review/capture/member/template/profile SQL helpers.

RLS policies on release and folder tables can remain unchanged because they already call the access/manage helper functions.

## 8. Exact TypeScript authorization plan

Create the new narrow resolver module, then wire Media Library call sites to it.

Recommended resolution shape:

```ts
type MediaLibraryAccessResolution = {
  role: MembershipRole;
  canAccess: boolean;
  canManageFolders: boolean;
  accessSource: "owner_admin" | "tenant_reviewer" | "custom_role" | "none";
  manageSource: "owner_admin" | "tenant_reviewer" | "custom_role" | "none";
};
```

`resolveMediaLibraryAccess(...)` should:

- call `resolveTenantMembership(...)` or equivalent membership lookup
- return owner/admin access and manage immediately from fixed role
- call `resolveEffectiveReviewerAccessForTenant(...)` for fixed reviewers and preserve tenant-wide reviewer behavior
- for any active tenant member, check assigned custom roles for `media_library.access`
- for any active tenant member, check assigned custom roles for `media_library.manage_folders`
- avoid changing `resolveTenantPermissions(...)`

`authorizeMediaLibraryAccess(...)` should:

- allow when `canAccess` is true
- throw `HttpError(403, "media_library_forbidden", ...)` otherwise
- be used by `listMediaLibraryAssets(...)`, `getMediaLibraryPageData(...)`, `getReleaseAssetDetail(...)`, and download via detail

`authorizeMediaLibraryFolderManagement(...)` should:

- allow when `canManageFolders` is true
- throw `HttpError(403, "media_library_forbidden", ...)` or a more specific `media_library_folder_management_forbidden` if tests and routes standardize on it
- be used by folder create, rename, archive, add, move, and remove service functions

Folder read behavior:

- `listActiveMediaLibraryFolders(...)` and `getActiveMediaLibraryFolder(...)` remain access-gated for page/detail reads
- mutation helpers call folder-management authorization first, then perform internal folder and asset validation reads

Call-site plan:

- update `src/lib/project-releases/project-release-service.ts` to delegate Media Library access checks to the new resolver
- update `src/lib/media-library/media-library-folder-service.ts` mutation functions to use folder-management authorization
- keep `src/lib/project-releases/media-library-download.ts` behavior unchanged except for the updated access gate it reaches through `getReleaseAssetDetail(...)`
- do not change correction, release snapshot creation, project review, capture, or member-management services

## 9. Exact UI/nav plan

Protected nav:

- `src/app/(protected)/layout.tsx` should stop using `permissions.canReviewProjects` as the Media Library proxy
- resolve a Media Library-specific access flag with `resolveMediaLibraryAccess(...)`
- pass `showMediaLibrary={mediaLibraryAccess.canAccess}` into `ProtectedNav`

Media Library page:

- `getMediaLibraryPageData(...)` should return `canManageFolders`
- page should pass `canManageFolders` into `MediaLibraryFolderBrowser`

Folder browser:

- add `canManageFolders` prop to `MediaLibraryFolderBrowser` and `MediaLibraryFolderBrowserView`
- when false, hide folder mutation controls:
  - create folder form/action
  - rename/archive buttons
  - selection checkboxes
  - add/move/remove action bar
- keep folder navigation/filtering visible to access-capable users
- keep Open and Download visible to access-capable users

No new page or dashboard is planned. Avoid new UI copy where hiding controls is enough. If disabled controls or helper text are added, use existing i18n structure in English and Dutch.

## 10. Relationship to Feature 084 non-enforcement boundary

Feature 084 currently has a test named around custom role assignments not granting live access. Feature 085 should update only the Media Library-specific expectations.

Keep non-enforcement for:

- project creation
- member management
- review/capture permissions
- correction/finalization behavior
- workspace staffing
- template/profile surfaces
- project/workspace custom role assignments

Change expectations only when an active tenant-scoped custom role assignment contains:

- `media_library.access` for list/detail/download
- `media_library.manage_folders` for folder mutations

## 11. Security and tenant isolation plan

Mitigations:

- cross-tenant custom role assignment: require assignment tenant, role tenant, and membership tenant all equal the server-resolved tenant
- revoked assignment: require `role_assignments.revoked_at is null`
- archived role: require `role_definitions.archived_at is null`
- system role confusion: require `role_definitions.is_system = false` for custom role capability checks
- project/workspace custom role leakage: require `scope_type = 'tenant'`, `project_id is null`, and `workspace_id is null`
- removed member: join `memberships` even though FK cascade should remove assignments
- TypeScript/SQL mismatch: add parity tests for access and manage helpers
- route/RLS mismatch: folder services use TS authorizers and authenticated writes still exercise RLS
- access-only folder writes: test service/API/RLS denial
- manage-only downloads: test detail/download/list denial
- accidental broad enforcement: do not import the resolver into non-Media-Library permission helpers

## 12. Fresh reset and seed/dev data plan

Assume local development can use:

```bash
supabase db reset
```

Do not preserve, repair, backfill, or normalize arbitrary old local custom-role assignment data.

Tests must create explicitly:

- custom role definitions
- capability mappings
- tenant-scoped custom role assignments
- revoked assignment cases
- archived-role cases
- tenant-wide and project-scoped reviewer assignments
- release and folder fixtures needed for Media Library assertions

No seed custom roles are required.

## 13. Test plan

SQL/RLS tests:

- owner/admin can access and manage
- tenant-wide system reviewer can access and manage
- project-scoped reviewer is denied tenant-wide Media Library access/manage
- custom role with `media_library.access` can access
- custom role with `media_library.manage_folders` can manage
- access-only custom role cannot manage folders
- manage-only custom role cannot access list/detail/download
- custom role without Media Library capabilities is denied
- revoked assignment is denied
- archived role is denied even with active assignment
- cross-tenant assignment is denied
- project/workspace-scoped custom role assignment is denied
- folder select/write RLS matches helper behavior

TypeScript/service tests:

- `resolveMediaLibraryAccess(...)` returns correct `canAccess` and `canManageFolders`
- `authorizeMediaLibraryAccess(...)` allows owner/admin, tenant-wide reviewer, and access custom role
- `authorizeMediaLibraryAccess(...)` denies project-scoped reviewer, no-capability role, revoked assignment, archived role, cross-tenant assignment, and manage-only role
- `authorizeMediaLibraryFolderManagement(...)` allows owner/admin, tenant-wide reviewer, and manage custom role
- folder create/rename/archive/add/move/remove use folder-management authorization
- access-only user cannot mutate folders
- custom role Media Library enforcement does not grant review/capture/project/member access

UI/nav tests:

- nav shows for owner/admin, tenant-wide reviewer, and `media_library.access` custom-role user
- nav stays hidden for denied users and manage-only users
- folder controls are hidden for access-only users
- folder controls are visible for manage-capable users who can access the page
- Open and Download remain visible for access-capable users

Regression tests:

- Feature 074 list/detail/download behavior remains intact
- Feature 077 safety badges, overlays, usage permission summaries, and advisory download confirmation remain intact
- Feature 078 folder latest-release carry-forward and historical detail behavior remain intact
- Feature 082 tenant-wide reviewer allowed and project-scoped reviewer denied remain intact
- Feature 083/084 custom role editor and assignment management behavior remains intact except Media Library-specific enforcement expectations

## 14. Risks and edge cases

- `media_library.manage_folders` without `media_library.access`: API/RLS can manage folders, but the current page/nav remains hidden. This is deliberate for the first slice; assign both capabilities for normal UI use.
- Direct download attempts by manage-only users must fail through `getReleaseAssetDetail(...)`.
- Folder writes through API must check folder-management authorization even when UI controls are hidden.
- Historical release detail must continue to work for access-capable users and fail for denied users.
- Archived custom roles with still-active assignment rows must not grant access.
- Revoked assignments must stop access immediately.
- Multiple custom roles should combine for Media Library only: one role can grant access and another can grant manage.
- Service-role reads for custom-role enforcement must happen only after membership validation and must be scoped by tenant/user/capability.
- SQL helper names should discourage generic use until a later feature designs app-wide capability semantics.

## 15. Implementation phases

### Phase 1 - SQL helper migration

- add `app.current_user_has_media_library_custom_role_capability(...)`
- update access/manage helper functions and wrappers
- keep existing table policies
- add SQL/RLS tests for helper behavior and folder policies

### Phase 2 - TypeScript resolver and authorizers

- add `src/lib/tenant/media-library-custom-role-access.ts`
- move/delegate Media Library access authorization to the new resolver
- add folder-management authorizer
- add resolver and authorizer tests

### Phase 3 - Service and route authorization wiring

- keep release list/detail/download behind access authorization
- switch folder mutations to folder-management authorization
- keep folder page reads behind access authorization
- extend route/service tests for access-only, manage-only, revoked, archived, cross-tenant, and scoped-assignment cases

### Phase 4 - Nav and UI gating

- update protected layout to compute Media Library-specific nav access
- pass `canManageFolders` through page data
- hide folder-management controls when false
- add/adjust UI tests

### Phase 5 - Regression validation

- run `supabase db reset`
- run Feature 074, 077, 078, 082, 083, 084, and new Feature 085 tests
- run lint
- confirm no non-Media-Library custom-role enforcement changed

## 16. Clear scope boundaries

In scope:

- Media Library access from active tenant-scoped custom roles
- Media Library folder-management from active tenant-scoped custom roles
- TypeScript access and management authorizers
- SQL/RLS helper parity
- nav visibility
- folder-management UI gating
- tests for access, denial, revocation, archive, tenant isolation, scope isolation, parity, and non-expansion

Out of scope:

- generic effective capability engine
- enforcing custom roles for projects, workspaces, capture, review, correction, finalization, templates, profiles, members, or invites
- project-scoped or workspace-scoped Media Library filtering
- per-folder or per-asset permissions
- Media Library folder data model changes
- release snapshot schema changes
- custom role editor redesign
- custom role assignment redesign
- invite-to-custom-role
- changing Feature 082 reviewer enforcement
- changing owner/admin fixed-role behavior
- changing photographer behavior
- changing correction, release, download-warning, consent, matching, or workflow semantics

## 17. Concise implementation prompt

Implement Feature 085 as a bounded Media Library-only custom-role enforcement slice. Add a narrow Media Library custom-role resolver for active tenant-scoped assignments with `media_library.access` and `media_library.manage_folders`, ignoring revoked assignments, archived roles, system roles, and project/workspace scopes. Update SQL helpers and TypeScript authorizers so owner/admin and Feature 082 tenant-wide reviewers still work, project-scoped reviewers remain denied for tenant-wide Media Library, access custom roles can list/detail/download, and manage custom roles can mutate folders. Keep manage-only users denied from nav/list/detail/download in this slice, and require both capabilities for normal UI folder-manager use. Hide folder-management UI for access-only users. Do not enforce custom roles outside Media Library, do not change release snapshots or folder data models, and validate with `supabase db reset` plus focused SQL/RLS, service, UI, and regression tests.
