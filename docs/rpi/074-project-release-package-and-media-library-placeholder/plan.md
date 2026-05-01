# Feature 074 Plan - Project release package and Media Library placeholder foundation

## Inputs and ground truth

Docs read in the requested order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `UNCODEXIFY.md`
- `docs/rpi/074-project-release-package-and-media-library-placeholder/research.md`

Targeted live verification used for this plan:

- Finalization and route seam:
  - `supabase/migrations/20260424110000_073_workspace_workflow_and_project_finalization.sql`
  - `src/lib/projects/project-workflow-service.ts`
  - `src/lib/projects/project-workflow-route-handlers.ts`
  - `src/app/api/projects/[projectId]/finalize/route.ts`
  - `tests/feature-073-project-workflow-foundation.test.ts`
  - `tests/feature-073-project-workflow-routes.test.ts`
- Export and storage delivery boundary:
  - `src/lib/project-export/project-export.ts`
  - `src/lib/project-export/response.ts`
  - `src/lib/assets/sign-asset-thumbnails.ts`
  - `src/lib/assets/sign-asset-playback.ts`
  - `tests/feature-043-simple-project-export-zip.test.ts`
- Permissions, protected layout, and nav:
  - `src/lib/tenant/permissions.ts`
  - `supabase/migrations/20260423121000_072_project_workspace_access.sql`
  - `src/components/navigation/protected-nav.tsx`
  - `src/app/(protected)/layout.tsx`
  - `tests/feature-073-project-workflow-ui.test.tsx`
- Snapshot-content source verification:
  - `supabase/migrations/20260305120000_004_assets_schema.sql`
  - `supabase/migrations/20260421120000_062_video_asset_type.sql`
  - `src/lib/matching/asset-preview-linking.ts`
  - `src/lib/matching/project-face-assignees.ts`
  - `src/lib/matching/whole-asset-linking.ts`
  - `src/lib/consent/project-consent-scope-state.ts`

Source-of-truth rule for this plan:

- Live code and live schema are authoritative.
- `research.md` is the primary synthesized source for planning.
- Older RPI context remains supporting context only.

Planning-critical drift found during targeted verification:

- No product-shaping drift was found versus `research.md`.
- One implementation seam is more specific in live code than the research summary: finalization route logic is funneled through `src/lib/projects/project-workflow-route-handlers.ts`, so Feature 074 should integrate there instead of expanding `src/app/api/projects/[projectId]/finalize/route.ts` directly.
- Export remains photo-only in live code, and current protected nav still has no Media Library item.

## Verified current boundary

Current live boundary confirmed for Feature 074:

- Feature 073 finalization is explicit, one-way, and idempotent through `projects.finalized_at` and `projects.finalized_by`.
- `finalizeProject(...)` currently has no post-finalization side effects.
- Repeating finalization after success returns the finalized workflow summary with `changed = false`.
- Export remains a separate workspace-scoped ZIP flow and is still allowed after finalization.
- Export is not a stored release artifact and should remain unchanged by Feature 074.
- Photos, headshots, and videos share the `assets` table, but only photos are exported today.
- Reviewer-capable authority still maps to `owner`, `admin`, and `reviewer`. Photographers do not have review/export authority.
- Current private media delivery uses short-lived signed URLs and server-streamed ZIP export; there is no general original-download route.
- Current protected UI already uses existing i18n message files and a normal list/detail layout pattern under the protected layout.

## Recommendation

Implement Feature 074 as a release-specific, project-scoped snapshot foundation that runs immediately after project finalization and drives a basic read-only Media Library.

Bounded recommendation:

1. Keep Feature 073 finalization as the publish boundary.
2. Add one additive migration that introduces immutable release tables, release-read RLS, and a tenant-level media-library read helper.
3. Add a release-specific snapshot service in `src/lib/project-releases/project-release-service.ts`.
4. Call `ensureProjectReleaseSnapshot(...)` immediately after `finalizeProject(...)` in the finalization handler.
5. Store one parent `project_releases` row and one `project_release_assets` row per included photo/video asset.
6. Reference existing source storage objects instead of copying or moving files.
7. Build a basic protected `/media-library` list page, `/media-library/[releaseAssetId]` detail page, and controlled download route.
8. Keep Media Library access limited to owner/admin/reviewer roles in the first slice.
9. Defer correction mode, release v2, DAM sync, folders, sharing, advanced search, and advanced asset management.

## Chosen architecture

Chosen architecture:

- Finalization remains the only publish trigger.
- Release creation happens immediately after successful finalization in the server route-handler layer.
- Release creation is synchronous in Feature 074.
- Release creation is idempotent and retry-safe.
- Release data uses a hybrid model:
  - relational `project_releases`
  - relational `project_release_assets`
  - structured JSONB snapshots for detailed consent/link/review/scope state
- Media Library reads only release rows and signed media derived from release source coordinates.
- Export ZIP code is not reused as the release package implementation.

Why release creation happens after finalization:

- Finalization is already the explicit human decision that reviewed project state is publishable.
- Finalization already guarantees the project is in the derived `ready_to_finalize` state.
- Finalization already has the authenticated actor, tenant scope, and reviewer authorization.
- The project/workspace review tables must remain editable source-of-truth before finalization, not become release tables themselves.

Why release creation is server-side and idempotent:

- Release creation reads across many tenant-scoped tables and must never trust client authority.
- Finalization retries and network retries must not create duplicate release versions or duplicate snapshot rows.
- The service can safely return an existing published release, repair a partial building release, or create a missing release for an already-finalized project.

Why release rows are immutable snapshots:

- The release package is a point-in-time publication of finalized project state.
- Mutable project/workspace review tables remain the editable operational model.
- Media Library becomes a consumption view, not an editing surface.
- Release immutability is also the seam that keeps future release v2 compatible without rewriting release v1.

Why Media Library reads release rows, not project review tables:

- The Media Library must show published state even if later project-side correction workflows exist in later features.
- Reading mutable review tables would blur the source-of-truth boundary and make release history non-auditable.
- Snapshot rows also avoid recomputing historical consent/link/review state from tables that may later change.

Why export ZIP generation is not the release package model:

- Export is workspace-scoped, release must be project-scoped.
- Export is photo-only, release must include both photos and videos.
- Export output is ZIP/sidecar oriented, release output must support read-only in-app list/detail reads.
- Export intentionally omits hidden, blocked, suppression, and manual-face snapshot detail needed for release auditing.

Why source storage objects are referenced, not copied:

- Project assets must not be destructively moved.
- There is no current product requirement to duplicate media just because it is released.
- Referencing source coordinates keeps Feature 074 smaller and cheaper while preserving immutable metadata rows.
- A future DAM/export pipeline can still copy externally from immutable release metadata if needed.

## Exact schema/model plan

Create one additive migration:

- Suggested file: `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`

Migration scope:

- create `project_releases`
- create `project_release_assets`
- add supporting indexes and constraints
- add release-read SQL helper functions
- enable RLS and read policies
- do not backfill historical releases in the migration

### `project_releases`

Columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete restrict`
- `project_id uuid not null`
- `release_version integer not null`
- `status text not null default 'building'`
- `created_by uuid not null references auth.users(id) on delete restrict`
- `created_at timestamptz not null default now()`
- `source_project_finalized_at timestamptz not null`
- `source_project_finalized_by uuid not null references auth.users(id) on delete restrict`
- `snapshot_created_at timestamptz null`
- `project_snapshot jsonb not null`

Foreign keys:

- foreign key `(project_id, tenant_id)` references `public.projects(id, tenant_id)` on delete restrict

Constraints:

- unique `(tenant_id, project_id, release_version)`
- unique `(tenant_id, project_id, source_project_finalized_at)`
- check `release_version >= 1`
- check `status in ('building', 'published')`
- check `jsonb_typeof(project_snapshot) = 'object'`
- check `(status = 'building' and snapshot_created_at is null) or (status = 'published' and snapshot_created_at is not null)`

Indexes:

- index `(tenant_id, project_id, created_at desc)`
- index `(tenant_id, created_at desc)`
- index `(tenant_id, source_project_finalized_at desc)`

Parent `project_snapshot` shape:

```json
{
  "schemaVersion": 1,
  "project": {
    "id": "uuid",
    "name": "string",
    "status": "active",
    "finalizedAt": "timestamp",
    "finalizedBy": "uuid"
  },
  "release": {
    "releaseId": "uuid",
    "releaseVersion": 1,
    "status": "published",
    "createdBy": "uuid",
    "createdAt": "timestamp",
    "snapshotCreatedAt": "timestamp"
  },
  "workspaces": [
    {
      "id": "uuid",
      "name": "string",
      "workspaceKind": "default|photographer"
    }
  ],
  "assetCounts": {
    "total": 0,
    "photo": 0,
    "video": 0
  }
}
```

### `project_release_assets`

Columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete restrict`
- `release_id uuid not null`
- `project_id uuid not null`
- `workspace_id uuid not null`
- `source_asset_id uuid not null`
- `asset_type text not null`
- `original_filename text not null`
- `original_storage_bucket text not null`
- `original_storage_path text not null`
- `content_type text null`
- `file_size_bytes bigint not null`
- `uploaded_at timestamptz null`
- `created_at timestamptz not null default now()`
- `asset_metadata_snapshot jsonb not null`
- `workspace_snapshot jsonb not null`
- `consent_snapshot jsonb not null`
- `link_snapshot jsonb not null`
- `review_snapshot jsonb not null`
- `scope_snapshot jsonb not null`

Foreign keys:

- foreign key `(release_id)` references `public.project_releases(id)` on delete restrict
- foreign key `(project_id, tenant_id)` references `public.projects(id, tenant_id)` on delete restrict
- foreign key `(workspace_id, tenant_id)` references `public.project_workspaces(id, tenant_id)` on delete restrict
- foreign key `(source_asset_id, tenant_id)` references `public.assets(id, tenant_id)` on delete restrict

Constraints:

- unique `(release_id, source_asset_id)`
- check `asset_type in ('photo', 'video')`
- check `file_size_bytes > 0`
- check `jsonb_typeof(asset_metadata_snapshot) = 'object'`
- check `jsonb_typeof(workspace_snapshot) = 'object'`
- check `jsonb_typeof(consent_snapshot) = 'object'`
- check `jsonb_typeof(link_snapshot) = 'object'`
- check `jsonb_typeof(review_snapshot) = 'object'`
- check `jsonb_typeof(scope_snapshot) = 'object'`

Indexes:

- index `(tenant_id, release_id, created_at desc)`
- index `(tenant_id, project_id, workspace_id, created_at desc)`
- index `(tenant_id, asset_type, created_at desc)`
- index `(tenant_id, source_asset_id)`

DAM-specific fields:

- Defer all DAM-specific columns and tables.
- Do not add `dam_sync_status`, `dam_sync_error`, `external_dam_asset_id`, or supersedence fields in Feature 074.

## Release versioning and immutability plan

Release versioning rules:

- Feature 074 only creates release version `1`.
- `release_version` is still stored and constrained so later features can create version `2+`.
- Feature 074 does not add correction mode, supersedence, or re-release UI/API.

Immutability rules:

- Published release parent rows are immutable from application behavior after status becomes `published`.
- Published release asset rows are immutable after they are written.
- A `building` release row is the only mutable release state in Feature 074, and only for retry/repair within the server-side release service.

Immutability enforcement choice for Feature 074:

- Use service-only writes plus RLS for the first slice.
- Do not add extra immutability triggers in Feature 074.

Reasoning:

- The service needs a simple repair path for `building` rows.
- Authenticated clients will not receive insert/update/delete policies for release tables.
- Immutability is still enforced in practice through:
  - no client write policies
  - no UI/API mutation surfaces
  - idempotent service behavior that never mutates published rows on retry

## Release creation timing and idempotency plan

Final behavior after `finalizeProject(...)` succeeds:

- `handleProjectFinalizePost(...)` calls `finalizeProject(...)`.
- Immediately afterward, the same handler calls `ensureProjectReleaseSnapshot(...)`.
- The handler returns the project workflow summary plus a release summary.

Finalization route behavior by case:

- Project not finalized yet, release creation succeeds:
  - return `200`
  - `changed = true`
  - `projectWorkflow.workflowState = 'finalized'`
  - `release.status = 'published'`
- Project already finalized and release already published:
  - return `200`
  - `changed = false`
  - return the existing release summary
- Project already finalized and release missing:
  - call `ensureProjectReleaseSnapshot(...)`
  - create and publish release version `1`
  - return `200`
- Project finalized or already-finalized and release build fails:
  - return `200` with finalized workflow summary and a repair warning
  - `release.status = 'missing'`
  - include a stable warning code such as `release_snapshot_pending_repair`

Chosen HTTP behavior for release-build failure after successful finalization:

- Do not hard-fail the finalize request once finalization is already committed.
- Return success with an explicit release warning payload.

Reasoning:

- Finalization is already durable and should not be reported as a full failure.
- The route can tell the UI the project is finalized but the release snapshot still needs repair.
- Repeating the same finalize request is then the repair action.

Suggested response extension:

```json
{
  "changed": true,
  "projectWorkflow": { "...": "..." },
  "release": {
    "id": "uuid|null",
    "releaseVersion": 1,
    "status": "published|missing",
    "assetCount": 0,
    "createdAt": "timestamp|null",
    "snapshotCreatedAt": "timestamp|null"
  },
  "warnings": [
    {
      "code": "release_snapshot_pending_repair",
      "message": "Project finalized, but the release snapshot is not available yet. Retry finalization to repair it."
    }
  ]
}
```

Repair path decision:

- Feature 074 does not need a separate repair route.
- The reusable repair seam is `ensureProjectReleaseSnapshot(...)`.
- The user-visible repair action is simply retrying `POST /api/projects/[projectId]/finalize`.

## Release creation service plan

Add a release-specific service:

- `src/lib/project-releases/project-release-service.ts`

Suggested public functions:

- `ensureProjectReleaseSnapshot(...)`
- `loadProjectRelease(...)`
- `listMediaLibraryAssets(...)`
- `getReleaseAssetDetail(...)`
- `authorizeMediaLibraryAccess(...)`

Optional internal helpers:

- `resolveOrCreateBuildingRelease(...)`
- `buildProjectReleaseSnapshot(...)`
- `buildReleaseAssetSnapshots(...)`
- `publishBuildingRelease(...)`
- `signReleaseAssetPreview(...)`

Creation strategy:

- Use plain server-side Supabase reads/writes with the admin client.
- Do not add an RPC or DB transaction helper in Feature 074.

Reasoning:

- Finalization is already a tiny idempotent update.
- Release snapshot generation is multi-read and multi-write work that can be retried.
- A `building -> published` parent row is enough to represent partial progress cleanly in the first slice.

`ensureProjectReleaseSnapshot(...)` contract:

1. Load the project in the tenant and require `finalized_at` and `finalized_by`.
2. Look up an existing release by `(tenant_id, project_id, source_project_finalized_at)`.
3. If an existing release is `published`, return it unchanged.
4. If no release exists, insert a parent row with:
   - `release_version = 1`
   - `status = 'building'`
   - `created_by = actorId`
   - `source_project_finalized_at = project.finalized_at`
   - `source_project_finalized_by = project.finalized_by`
   - provisional `project_snapshot`
5. If a `building` release exists, treat it as repairable and rebuild it in place.
6. Load all eligible source assets and all snapshot metadata needed for those assets.
7. Delete any existing child rows for the `building` release.
8. Insert the rebuilt child rows in deterministic chunks.
9. Update the parent row to `status = 'published'`, set `snapshot_created_at`, and write the final `project_snapshot`.
10. Return the published release summary.

Retry-safety and partial failure handling:

- Unique `(tenant_id, project_id, source_project_finalized_at)` prevents duplicate release parents for the same finalization event.
- Unique `(tenant_id, project_id, release_version)` keeps version `1` unique.
- A partial build leaves the parent in `building`.
- A later retry reuses the same parent row, clears child rows for that release, and rebuilds deterministically.
- Published releases are returned unchanged.

Chunking:

- Insert child rows in bounded chunks such as 100 rows per insert to avoid oversized payloads.

## Exact release eligibility rules

Release precondition:

- Project must exist in the resolved tenant and be finalized.

Included assets:

- all assets in the finalized project across all project workspaces
- `assets.status = 'uploaded'`
- `archived_at is null`
- `asset_type in ('photo', 'video')`

Excluded assets:

- `asset_type = 'headshot'`
- non-uploaded assets
- archived assets

State handling rules:

- hidden faces, blocked faces, suppressions, and manual faces are metadata only
- they do not exclude an otherwise eligible asset
- assets with no links are still included
- video assets are included even though they have no exact-face materialization flow

Zero-asset rule:

- A finalized project with no eligible photo/video assets still gets a published release parent row with zero child rows.

## Exact snapshot content plan

Release snapshots must be documented and bounded. Feature 074 should not store vague catch-all blobs.

### `asset_metadata_snapshot`

Purpose:

- immutable source-asset metadata used by Media Library list/detail and future outbound integrations

Shape:

```json
{
  "schemaVersion": 1,
  "sourceAsset": {
    "assetId": "uuid",
    "assetType": "photo|video",
    "originalFilename": "string",
    "contentType": "string|null",
    "fileSizeBytes": 123,
    "uploadedAt": "timestamp|null",
    "storageBucket": "string",
    "storagePath": "string"
  },
  "photoMaterialization": {
    "materializationId": "uuid",
    "materializerVersion": "string",
    "provider": "string",
    "providerMode": "string",
    "faceCount": 0,
    "sourceImageWidth": 0,
    "sourceImageHeight": 0,
    "sourceCoordinateSpace": "string"
  }
}
```

Rules:

- `photoMaterialization` is present for photos when a current materialization exists.
- `photoMaterialization` is `null` for videos.

Primary sources:

- `assets`
- `asset_face_materializations`

### `workspace_snapshot`

Purpose:

- immutable project/workspace context for the released asset

Shape:

```json
{
  "schemaVersion": 1,
  "project": {
    "id": "uuid",
    "name": "string",
    "status": "active",
    "finalizedAt": "timestamp",
    "finalizedBy": "uuid"
  },
  "workspace": {
    "id": "uuid",
    "name": "string",
    "workspaceKind": "default|photographer"
  },
  "release": {
    "releaseId": "uuid",
    "releaseVersion": 1,
    "createdAt": "timestamp",
    "snapshotCreatedAt": "timestamp|null"
  }
}
```

Primary sources:

- `projects`
- `project_workspaces`
- `project_releases`

### `consent_snapshot`

Purpose:

- immutable linked-person summary for list/detail reads

Shape:

```json
{
  "schemaVersion": 1,
  "linkedOwners": [
    {
      "projectFaceAssigneeId": "uuid|string",
      "identityKind": "project_consent|project_recurring_consent",
      "consentId": "uuid|null",
      "recurringProfileConsentId": "uuid|null",
      "projectProfileParticipantId": "uuid|null",
      "profileId": "uuid|null",
      "displayName": "string|null",
      "email": "string|null",
      "currentStatus": "active|revoked",
      "signedAt": "timestamp|null",
      "consentVersion": "string|null",
      "faceMatchOptIn": true
    }
  ],
  "linkedPeopleCount": 0
}
```

Rules:

- one-off and recurring project consent owners stay distinct through `identityKind`
- linked people count is derived from unique assignee/fallback owner entries

Primary sources:

- `project_face_assignees`
- `loadProjectFaceAssigneeDisplayMap(...)`
- `consents`
- `recurring_profile_consents`

### `link_snapshot`

Purpose:

- immutable exact-link, whole-asset-link, and fallback-link state

Shape:

```json
{
  "schemaVersion": 1,
  "exactFaceLinks": [
    {
      "assetFaceId": "uuid",
      "materializationId": "uuid",
      "faceRank": 1,
      "projectFaceAssigneeId": "uuid",
      "identityKind": "project_consent|project_recurring_consent",
      "consentId": "uuid|null",
      "recurringProfileConsentId": "uuid|null",
      "projectProfileParticipantId": "uuid|null",
      "profileId": "uuid|null",
      "linkSource": "manual|auto",
      "matchConfidence": 0.95
    }
  ],
  "wholeAssetLinks": [
    {
      "projectFaceAssigneeId": "uuid",
      "identityKind": "project_consent|project_recurring_consent",
      "consentId": "uuid|null",
      "recurringProfileConsentId": "uuid|null",
      "projectProfileParticipantId": "uuid|null",
      "profileId": "uuid|null",
      "linkSource": "manual"
    }
  ],
  "fallbackLinks": [
    {
      "consentId": "uuid",
      "projectFaceAssigneeId": "fallback:consent-id"
    }
  ]
}
```

Fallback representation rule:

- Snapshot fallback links separately from whole-asset links.
- If a one-off consent already has a canonical whole-asset link for the same asset, do not also snapshot the historical fallback row for that same asset/consent pair.
- This matches the current export dedupe behavior and prevents double-counting.

Video rule:

- videos have `exactFaceLinks = []`
- videos may still have `wholeAssetLinks`
- videos have `fallbackLinks = []`

Primary sources:

- `asset_face_consent_links`
- `asset_assignee_links`
- `asset_consent_manual_photo_fallbacks`

### `review_snapshot`

Purpose:

- immutable review-state snapshot for blocked/hidden/manual/suppression behavior

Shape:

```json
{
  "schemaVersion": 1,
  "faces": [
    {
      "assetFaceId": "uuid",
      "materializationId": "uuid",
      "faceRank": 1,
      "faceSource": "detector|manual",
      "detectionProbability": 0.9,
      "faceBox": {},
      "faceBoxNormalized": {}
    }
  ],
  "hiddenFaces": [
    {
      "assetFaceId": "uuid",
      "hiddenAt": "timestamp"
    }
  ],
  "blockedFaces": [
    {
      "assetFaceId": "uuid",
      "blockedAt": "timestamp",
      "reason": "no_consent"
    }
  ],
  "faceLinkSuppressions": [
    {
      "assetFaceId": "uuid",
      "projectFaceAssigneeId": "uuid"
    }
  ],
  "assigneeLinkSuppressions": [
    {
      "assetFaceId": "uuid",
      "projectFaceAssigneeId": "uuid"
    }
  ],
  "manualFaces": [
    {
      "assetFaceId": "uuid",
      "faceRank": 2
    }
  ]
}
```

Video rule:

- videos store empty arrays for face-specific review state because there is no exact-face materialization flow today

Primary sources:

- `asset_face_materialization_faces`
- `asset_face_hidden_states`
- `asset_face_block_states`
- `asset_face_consent_link_suppressions`
- `asset_face_assignee_link_suppressions`

### `scope_snapshot`

Purpose:

- immutable effective scope states for linked owners, plus signed scope snapshots where available

Shape:

```json
{
  "schemaVersion": 1,
  "owners": [
    {
      "projectFaceAssigneeId": "uuid|string",
      "identityKind": "project_consent|project_recurring_consent",
      "consentId": "uuid|null",
      "recurringProfileConsentId": "uuid|null",
      "projectProfileParticipantId": "uuid|null",
      "effectiveScopes": [
        {
          "templateKey": "string",
          "scopeKey": "string",
          "label": "string",
          "status": "granted|not_granted|revoked|not_collected",
          "governingSourceKind": "project_consent|project_recurring_consent"
        }
      ],
      "signedScopes": [
        {
          "templateKey": "string",
          "scopeKey": "string",
          "label": "string",
          "granted": true
        }
      ]
    }
  ]
}
```

Rules:

- effective scopes come from the current governing consent/participant state at release time
- signed scope rows are populated for one-off linked consents when projection rows exist, otherwise they can be built from the consent structured-field snapshot
- recurring-linked owners keep `signedScopes = []` in Feature 074 unless there is already a direct reusable signed projection source

Primary sources:

- `loadProjectConsentScopeStatesByConsentIds(...)`
- `loadProjectConsentScopeStatesByParticipantIds(...)`
- `project_consent_scope_signed_projections`
- current export helper logic for signed-scope fallback

## Reuse of existing helpers

Safe helpers to reuse directly:

- `finalizeProject(...)`
- `resolveTenantId(...)`
- `resolveTenantPermissions(...)`
- `assertCanReviewProjectAction(...)`
- `resolveSignedAssetDisplayUrl(...)`
- `signVideoPlaybackUrlsForAssets(...)`
- `loadProjectFaceAssigneeDisplayMap(...)`
- `loadCurrentWholeAssetLinksForAssets(...)`
- `loadProjectConsentScopeStatesByConsentIds(...)`
- `loadProjectConsentScopeStatesByParticipantIds(...)`

Helpers and patterns to reuse only at the low-level reader layer:

- asset/materialization/faces/fallback loading patterns from `loadProjectExportRecords(...)`
- signed-scope fallback shaping from export

Export code that must not be reused directly:

- `createProjectExportResponse(...)`
- `buildPreparedProjectExport(...)`
- ZIP file naming and ZIP assembly code
- export guardrails that are ZIP-specific

New low-level readers likely needed:

- a release reader for photo materialization rows and face rows by asset ids
- a release reader for hidden, blocked, and suppression rows by asset ids
- a release reader for fallback-link rows by asset ids
- a release reader for signed scope projection rows by consent ids

Reasoning:

- This avoids duplicating complex current-state logic while keeping release assembly independent from photo-only ZIP formatting.

## Media Library access model

First-slice role access:

- owner: allowed
- admin: allowed
- reviewer: allowed
- photographer: not allowed

Visibility model:

- tenant-level visibility for reviewer-capable roles
- no workspace gating on release rows in Feature 074
- workspace ids remain traceability metadata only

TS helper choice:

- Add `authorizeMediaLibraryAccess(...)` in the new release service layer as a tenant-level wrapper around `resolveTenantPermissions(...)`.
- It should require `canReviewProjects = true`.

SQL helper choice:

- Add `app.current_user_can_access_media_library(p_tenant_id uuid)` and a `public.` wrapper.
- Implementation should allow membership roles `owner`, `admin`, and `reviewer`.
- Use that helper in release-table select policies.

## Exact Media Library API, route, and page plan

Routes and pages:

- page: `src/app/(protected)/media-library/page.tsx`
- detail page: `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- download route: `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`

Rendering model:

- list and detail are server-rendered protected pages
- no separate list/detail JSON API is needed in Feature 074
- shared server-side service functions should supply the page data
- unauthenticated page access continues to redirect through the protected layout
- page loaders should treat missing or unauthorized release rows as `notFound()` to avoid leaking tenant asset existence through direct URL probing

List page shape:

- read-only table or simple stacked list
- default order:
  - newest release first
  - then newest asset within the release
- columns/fields:
  - preview thumbnail or poster
  - filename
  - asset type
  - project name
  - release version
  - workspace name
  - linked people count
  - release created date

Detail page shape:

- source preview or video playback
- project and workspace source summary
- release/version metadata
- linked owner summary
- exact-face, whole-asset, and fallback summary
- hidden, blocked, suppression, and manual-face summary where relevant
- scope summary
- download action

Download route behavior:

- method: `GET`
- auth required
- resolve active tenant server-side
- require media-library access
- look up the release asset in the tenant
- authorize off the release row, not direct storage coordinates from the request
- return redirect to a short-lived signed URL

Download route error behavior:

- `401 unauthenticated`
- `403 media_library_forbidden` for non-reviewer roles
- `404 release_asset_not_found` for missing or cross-tenant rows
- `409 release_asset_source_missing` if the release row exists but the source object is gone

## Exact download/original delivery plan

Chosen behavior:

- authorize server-side
- redirect to a short-lived signed URL

Why:

- matches current private-media delivery patterns
- keeps storage authority on the server
- avoids overbuilding a streaming proxy in the first slice

Authority rule:

- raw storage bucket/path must never come from the client
- storage coordinates are read from the release row after authorization

Missing source object behavior:

- do not mutate the release row
- return controlled `409 release_asset_source_missing`

Filename expectation:

- first slice accepts the storage-path filename used in the signed URL target
- do not add custom content-disposition streaming logic in Feature 074

## Media Library UI and i18n plan

Protected nav changes:

- add `nav.mediaLibrary` to `messages/en.json`
- add `nav.mediaLibrary` to `messages/nl.json`
- extend `ProtectedNav` to accept `showMediaLibrary`
- compute `showMediaLibrary` from `resolveTenantPermissions(...).canReviewProjects`

New i18n namespaces:

- `mediaLibrary.list`
- `mediaLibrary.detail`

Expected message keys:

- list title
- list subtitle
- empty state
- column labels
- asset type labels
- release metadata labels
- linked people count label
- detail back link
- detail download action
- detail section labels
- release warning text for finalize UI if needed

UI direction:

- normal protected app list/detail pages
- no hero section
- no decorative dashboard shell
- no oversized rounded card grid
- no fake DAM terminology
- do not use "umbrella project" wording in user-facing copy

Preview behavior:

- list page signs photo thumbnails or video poster thumbnails from source coordinates
- detail page signs a larger photo preview or video playback URL
- signed preview URLs are request-time data only and are not stored in release rows

## RLS and server authority plan

`project_releases` RLS:

- enable RLS
- grant `select` to `authenticated`
- grant full table privileges to `service_role`
- select policy uses `app.current_user_can_access_media_library(tenant_id)`
- no insert/update/delete policies for `authenticated`

`project_release_assets` RLS:

- enable RLS
- grant `select` to `authenticated`
- grant full table privileges to `service_role`
- select policy uses `app.current_user_can_access_media_library(tenant_id)`
- no insert/update/delete policies for `authenticated`

Server authority rules:

- release creation only runs from server code
- release creation never accepts `tenant_id` from the client
- finalization/release creation uses auth client for actor validation and admin client for writes
- list/detail/download can read release rows with the authenticated client under RLS, then use server-side signing helpers for media URLs

## Exact finalization integration plan

Files to change during implementation:

- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/app/api/projects/[projectId]/finalize/route.ts`
- new release service files

Integration behavior:

- extend `ProjectFinalizeDependencies` to inject `ensureProjectReleaseSnapshot`
- call `ensureProjectReleaseSnapshot(...)` after `finalizeProject(...)`
- include release summary in the finalize response

Idempotent finalization/release cases:

- already finalized + release published:
  - return existing published release
- already finalized + release missing:
  - create release version `1`
- finalized now + release build fails:
  - leave project finalized
  - return warning payload
- `building` row exists:
  - retry path reuses and repairs that building row

Feature 073 lock preservation:

- do not change any workflow mutability checks
- do not add reopen behavior
- do not let Media Library writes modify project/workspace review data

## Security and reliability considerations

Tenant scoping:

- every release query must filter by resolved tenant id
- RLS on new tables must also enforce tenant reviewer access

Role gating:

- list/detail/download require owner/admin/reviewer
- nav visibility must match the same permission model

Immutability:

- published rows are returned unchanged on retry
- no client write policies exist on release tables

Retry safety:

- finalization remains idempotent
- release creation is keyed by source finalized timestamp
- `building` rows are rebuildable in place

Partial failure recovery:

- no background worker in Feature 074
- retrying the finalize endpoint is the repair action
- release warning payload makes partial completion explicit to the UI

Storage-object reference risk:

- release rows depend on source object continued existence
- download route must handle missing objects explicitly
- release rows must stay visible even if source object later disappears

Why Media Library is not an editing surface:

- project/workspace review state remains the editable source of truth
- release rows are consumption artifacts only

Why DAM sync fields are deferred:

- immutable release ids and source ids already provide the future extension seam
- placeholder fields would add speculative complexity without current product behavior

## Edge cases

- Finalized project with no eligible assets:
  - create published parent release with zero child rows
  - Media Library asset list shows nothing for that release
- Project already finalized before Feature 074 migration:
  - no migration backfill
  - retrying the finalize endpoint creates the missing release
- Finalization retry when release exists:
  - return existing published release unchanged
- Finalization retry when release is missing:
  - create the missing release
- Release creation interrupted after parent row but before all assets:
  - row remains `building`
  - retry clears child rows and rebuilds
- Source asset archived after release:
  - release row remains visible
  - download still works if source object still exists
- Source storage object missing at download time:
  - return `409 release_asset_source_missing`
  - do not mutate release rows
- Video asset with whole-asset links only:
  - included
  - exact-face arrays remain empty
- Photo asset with blocked faces:
  - included
  - blocked state stored in `review_snapshot`
- Asset with no links:
  - included
  - linked owner arrays are empty
- Cross-tenant release asset access:
  - hidden by tenant filtering and RLS
  - API returns `404`
- Photographer tries to access Media Library:
  - nav item absent
  - pages/download denied by role check

## Test plan

New or extended tests:

- `tests/feature-073-project-workflow-routes.test.ts`
  - finalize route injects and returns release summary
  - finalize route repairs missing release for already-finalized project
  - finalize route returns warning payload when release snapshot build fails
- `tests/feature-073-project-workflow-foundation.test.ts`
  - finalization still does not block export
  - repeat finalize plus ensure does not mutate an already-published release
- new `tests/feature-074-project-release-service.test.ts`
  - release creation allowed only for finalized projects
  - release creation rejected before finalization
  - same finalized project returns the same release on retry
  - first release version is `1`
  - building-row retry repairs partial state
  - photos and videos included
  - headshots excluded
  - zero-asset finalized project still creates parent release
  - source asset id and workspace id stored correctly
  - release creation does not mutate source asset rows
- new `tests/feature-074-project-release-schema.test.ts`
  - constraints reject invalid `status`
  - constraints reject invalid `asset_type`
  - unique `(tenant_id, project_id, release_version)` enforced
  - unique `(tenant_id, project_id, source_project_finalized_at)` enforced
  - authenticated clients cannot insert/update/delete release rows
- new `tests/feature-074-media-library-routes.test.ts`
  - reviewer-capable roles can read Media Library list/detail loaders
  - photographers are blocked from Media Library list/detail reads
  - cross-tenant release rows are inaccessible to list/detail reads
  - reviewer-capable roles can download
  - photographers cannot download
  - missing source object returns controlled error
- new `tests/feature-074-media-library-ui.test.tsx`
  - nav item shows only for reviewer-capable roles
  - list view renders filename/project/release/workspace metadata
  - detail view renders read-only release summaries

Existing export tests to preserve:

- `tests/feature-043-simple-project-export-zip.test.ts`
  - no behavior change expected
  - keep export workspace-scoped and photo-only

## Implementation phases

### Phase 1 - Schema and types

- add migration
- add release table types
- add SQL helper functions and RLS
- add any release-specific TS types
- run schema-focused tests

### Phase 2 - Release snapshot service

- implement `ensureProjectReleaseSnapshot(...)`
- implement release read helpers
- add snapshot-content readers
- add service tests for idempotency, inclusion rules, and building repair

### Phase 3 - Finalization integration

- inject release service into finalization handler
- extend finalize response shape
- add warning payload behavior
- extend Feature 073 route/foundation tests

### Phase 4 - Media Library routes and server reads

- implement tenant-level list/detail loaders
- implement download route
- add route authorization and missing-object tests

### Phase 5 - UI navigation, pages, and i18n

- add nav item gating
- build read-only list page
- build read-only detail page
- add English and Dutch messages
- add UI rendering tests

### Phase 6 - Verification

- run targeted tests after each phase
- run lint before completion
- confirm export behavior remains unchanged
- confirm finalization lock behavior remains unchanged

## Scope boundaries

Implements now:

- release schema
- idempotent release snapshot service
- release creation after finalization
- repair via finalize retry
- read-only Media Library list
- read-only released asset detail
- controlled original download route
- tenant-level reviewer-capable release access
- tests for permissions, idempotency, immutability behavior, download, and finalization integration

Deferred:

- correction mode
- project reopen
- release version `2+`
- supersedence fields
- DAM sync tables and status fields
- external publishing
- folders or collections
- advanced search or filtering
- asset movement or editing inside the library
- public sharing
- advanced audit dashboards
- notification or email workflows
- billing or storage quota logic
- background release worker

## Concise implementation prompt

Implement Feature 074 exactly against this plan as the contract. Work in phases, keep changes small, and do not expand scope into correction mode, release v2, DAM sync, or advanced Media Library management. After each phase, run the relevant tests before moving on. If live code forces a deviation from this plan, update the plan first or report the deviation explicitly before continuing.
