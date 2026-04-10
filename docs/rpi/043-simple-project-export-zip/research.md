# Feature 043 Research: Simple Project Export ZIP

## Scope

Research how to add a first, bounded "Export project" feature that lets a staff user download one ZIP for a single project.

Requested first scope:

- one downloadable ZIP
- one project at a time
- no DAM/API connector design
- no async enterprise export workflow unless the current repo clearly requires it
- no export history table unless clearly necessary
- no schema redesign unless clearly needed

This document is research only. No implementation changes were made.

## Inputs reviewed

Required project docs, in order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`

Relevant prior RPI docs:

- `docs/rpi/004-project-assets/research.md`
- `docs/rpi/006-headshot-consent/research.md`
- `docs/rpi/031-one-consent-per-face-precedence-rules/research.md`
- `docs/rpi/032-face-consent-linking-ui-improvements/research.md`
- `docs/rpi/033-asset-face-overlays-and-confidence/research.md`
- `docs/rpi/038-original-image-ingest-and-display-derivatives/research.md`
- `docs/rpi/039-consent-form-template-editor/research.md`
- `docs/rpi/040-asset-display-derivatives-reliability/research.md`
- `docs/rpi/042-structured-consent-template-fields/research.md`
- `docs/rpi/003-consent-templates/research.md`

Schema and migrations verified directly:

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260304211000_002_projects_invites_rls.sql`
- `supabase/migrations/20260305100000_003_consent_templates_schema.sql`
- `supabase/migrations/20260305103000_003_consent_templates_submit.sql`
- `supabase/migrations/20260305120000_004_assets_schema.sql`
- `supabase/migrations/20260305121000_004_assets_rls.sql`
- `supabase/migrations/20260305122000_004_assets_storage.sql`
- `supabase/migrations/20260305150000_005_assets_content_hash.sql`
- `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`
- `supabase/migrations/20260306130000_010_auto_match_backbone_schema.sql`
- `supabase/migrations/20260313162000_017_match_result_faces.sql`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260327120000_023_request_uri_safety.sql`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260404110000_032_face_review_sessions_and_derivatives.sql`
- `supabase/migrations/20260404120000_032_face_derivative_storage.sql`
- `supabase/migrations/20260407133000_038_asset_image_derivative_pipeline.sql`
- `supabase/migrations/20260407213000_042_structured_consent_template_fields.sql`

Primary code paths verified directly:

- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- `src/app/i/[token]/page.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`
- `src/lib/assets/asset-image-derivatives.ts`
- `src/lib/assets/asset-image-derivative-worker.ts`
- `src/lib/assets/post-finalize-processing.ts`
- `src/lib/consent/submit-consent.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/supabase/admin.ts`
- `src/lib/supabase/server.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/templates/structured-fields.ts`
- `src/lib/tenant/resolve-tenant.ts`

Relevant tests checked:

- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
- `tests/feature-038-asset-image-derivatives.test.ts`
- `tests/feature-042-structured-consent-template-fields.test.ts`

## Executive summary

The repo can support a bounded first project export without schema redesign.

Most important verified findings:

1. `assets` is still the canonical file table, but the live photo-link model is no longer `asset_consent_links`.
   - `asset_consent_links` is now effectively the headshot-to-consent table.
   - current photo links live in `asset_face_consent_links` plus `asset_consent_manual_photo_fallbacks`.

2. The repo already has enough data to export useful current-state metadata now.
   - original photo files
   - original filenames
   - current linked consent/person data
   - current revoked/not-revoked state
   - signed consent text/version snapshots
   - structured signed values via `consents.structured_fields_snapshot`
   - current face boxes via `asset_face_materialization_faces`

3. The simplest correct first delivery model is a synchronous Node route that generates one ZIP and returns it directly.
   - there is no current export job/history model
   - there is no ZIP library in `package.json` today
   - there are no repo signals that a staged async export is required for the first cut

4. The safest file choice for exported project assets is the original uploaded file from `project-assets`, not the display derivative.
   - originals are preserved as source-of-truth
   - display derivatives are lossy JPEG UI artifacts

5. The main gap is not missing data. It is shaping the export around current canonical state and making the first ZIP path memory-safe enough for bounded project sizes.

## 1. Current live data model

### Projects

Live table:

- `public.projects`

Verified fields relevant to export:

- `id`
- `tenant_id`
- `name`
- `description`
- `status`
- `default_consent_template_id`
- `created_at`

Current access pattern:

- protected pages and routes derive tenant server-side with `resolveTenantId()` / `ensureTenantId()`
- project reads always filter by `tenant_id` and `id`

### Assets

Live canonical file table:

- `public.assets`

Verified fields relevant to export:

- `id`
- `tenant_id`
- `project_id`
- `created_by`
- `storage_bucket`
- `storage_path`
- `original_filename`
- `content_type`
- `file_size_bytes`
- `content_hash`
- `content_hash_algo`
- `asset_type` (`photo` or `headshot`)
- `status` (`pending`, `uploaded`, `archived`)
- `uploaded_at`
- `archived_at`
- `retention_expires_at`

Verified storage model:

- original files are stored in private Supabase Storage bucket `project-assets`
- storage path is server-generated as:
  - `tenant/<tenantId>/project/<projectId>/asset/<assetId>/<sanitizedFileName>`
- upload creation is in `src/lib/assets/create-asset.ts`
- finalized assets are marked uploaded in `src/lib/assets/finalize-asset.ts`

Important export implication:

- first project export should export `asset_type = 'photo'` assets, not headshots
- headshots are stored in the same table, but current UX and matching logic treat them separately from project photo assets

### Consents

Live table:

- `public.consents`

Verified fields relevant to export:

- `id`
- `tenant_id`
- `project_id`
- `subject_id`
- `invite_id`
- `consent_text`
- `consent_version`
- `signed_at`
- `revoked_at`
- `revoke_reason`
- `face_match_opt_in`
- `structured_fields_snapshot`
- `receipt_email_sent_at`
- `capture_ip`
- `capture_user_agent`
- `created_at`

Important export implications:

- the signed legal snapshot is already on the consent row:
  - `consent_text`
  - `consent_version`
- structured signed values are live and audit-oriented:
  - `structured_fields_snapshot`
- revocation is current-state metadata on the same row:
  - `revoked_at`
  - `revoke_reason`

### Subjects

Live table:

- `public.subjects`

Verified fields visible to staff today:

- `id`
- `tenant_id`
- `project_id`
- `email`
- `full_name`
- `created_at`

Important audit limitation:

- subject identity is not snapshotted onto `consents`
- `submit_public_consent` upserts `subjects` by `(tenant_id, project_id, email)` and updates `full_name` on conflict
- current project UI joins the current subject row, not a historical identity snapshot

Export implication:

- current subject name/email can be exported
- but they are current joined values, not immutable signed identity fields

### Subject invites

Live table:

- `public.subject_invites`

Verified fields relevant to export research:

- `id`
- `tenant_id`
- `project_id`
- `created_by`
- `token_hash`
- `status`
- `expires_at`
- `max_uses`
- `used_count`
- `consent_template_id`
- `created_at`

Export implication:

- `invite_id` on `consents` is reliable and can be included in consent JSON
- template row linkage still exists through the invite, but the signed legal snapshot already lives on `consents`

### Asset-to-consent links

This needs special care because the repo evolved.

#### `asset_consent_links`

Still exists, but live usage is now:

- headshot-to-consent links
- not the canonical current photo-link table anymore

Verified evidence:

- `finalizeAsset()` only writes `asset_consent_links` for `headshot` assets
- `loadCurrentProjectConsentHeadshots()` and headshot replacement routes read `asset_consent_links`
- Feature 031 migrated photo links out of `asset_consent_links`

#### Current canonical photo-link tables

Current photo-to-consent state is split across:

- `public.asset_face_consent_links`
  - one current consent assignment per current detected face
- `public.asset_consent_manual_photo_fallbacks`
  - manual asset-level links only when the current materialization has zero detected faces
- `public.asset_face_consent_link_suppressions`
- `public.asset_consent_manual_photo_fallback_suppressions`

Export implication:

- export must treat photo links as:
  - current face links
  - plus zero-face fallbacks
- exporting photo links from `asset_consent_links` would be wrong

#### Legacy migration tables

Also present:

- `asset_consent_legacy_photo_links`
- `asset_consent_legacy_photo_link_suppressions`

These are migration/history aids, not the current canonical read model.

### Face bounding boxes and matching tables

Bounding boxes do exist in the live system.

Relevant tables:

- `public.asset_face_materializations`
- `public.asset_face_materialization_faces`
- `public.asset_consent_face_compares`
- `public.asset_face_image_derivatives`

Verified bounding-box fields:

- `asset_face_materializations`
  - `materializer_version`
  - `provider`
  - `provider_mode`
  - `face_count`
  - `usable_for_compare`
  - `source_image_width`
  - `source_image_height`
  - `source_coordinate_space` (`oriented_original`)
- `asset_face_materialization_faces`
  - `id`
  - `face_rank`
  - `detection_probability`
  - `face_box`
  - `face_box_normalized`
  - `embedding`

Current code reads both raw and normalized boxes, and UI overlays now use `face_box_normalized`.

Export implication:

- bounding boxes can be exported now
- the most stable downstream shape is:
  - normalized box coordinates
  - plus source image dimensions and coordinate-space metadata

### Structured consent snapshot fields

Feature 042 is live.

Verified fields:

- `consent_templates.structured_fields_definition`
- `consents.structured_fields_snapshot`

Verified runtime behavior:

- public invite render returns `structured_fields_definition`
- public submit validates structured values against the invite-linked template version
- signed consent stores immutable `structured_fields_snapshot`
- archived-version invites still sign using that archived template version

Export implication:

- structured signed values can be exported cleanly now from `consents.structured_fields_snapshot`

## 2. What can be exported today without redesign

### Asset files

Can export now:

- original uploaded project photo files from `assets.storage_bucket` + `assets.storage_path`
- only where:
  - `asset_type = 'photo'`
  - `status = 'uploaded'`
  - `archived_at is null` is recommended for safety

Current repo support:

- private storage download is already used server-side by the derivative worker
- service-role access is already standard via `createAdminClient()`

### Asset filenames

Can export now:

- `assets.original_filename`

Caveat:

- duplicates are possible
- original filenames are not guaranteed safe for ZIP entry names

### Linked consent/person data

Can export now:

- current asset-to-consent assignments through:
  - `listPhotoConsentAssignmentsForAssetIds()`
  - `listLinkedFaceOverlaysForAssetIds()`
  - direct reads of `asset_consent_manual_photo_fallbacks` when link mode needs to be explicit

Current subject/person info available to staff:

- `subjects.full_name`
- `subjects.email`
- `subjects.id`

Audit caveat:

- `full_name` and `email` are current joined values, not immutable historical snapshots

### Current consent state

Can export now:

- active vs revoked from `consents.revoked_at`
- `revoke_reason`
- `face_match_opt_in`

Important verified behavior:

- revoked consents keep historical records
- revoked consents cannot gain new manual or auto photo assignments
- current face-link reconciliation preserves historical auto rows for revoked or no-longer-opted-in consents instead of silently deleting them

### Signed snapshot data

Can export now:

- `consent_text`
- `consent_version`
- `structured_fields_snapshot`

Not available today:

- no signed PDF/form document artifact
- no separate immutable subject identity snapshot

### Face boxes / bounding boxes

Can export now:

- per-face rows from `asset_face_materialization_faces`
- `face_box`
- `face_box_normalized`
- `detection_probability`
- `face_rank`
- `source_image_width`
- `source_image_height`
- `source_coordinate_space`

Important limitation:

- zero-face manual fallbacks have no exact face box by definition

### Structured consent values

Can export now:

- full `structured_fields_snapshot`

That snapshot already contains:

- `templateSnapshot`
- `definition`
- normalized signed `values`

## 3. ZIP export delivery model

### Option A: synchronous server-side ZIP generation and direct download

How it would fit the repo:

- authenticated route under `src/app/api/projects/[projectId]/...`
- server derives tenant from session
- server validates project membership
- server uses service-role client for DB reads and private storage reads
- response streams one ZIP directly to the browser

Pros:

- matches the current repo's direct route-handler pattern
- no new async table, history table, or worker is required
- best fit for first scope

Cons:

- runtime and memory risk grow with project size
- current Supabase `download()` returns a `Blob`, so careless implementation can buffer too much
- no ZIP dependency exists today in `package.json`

Assessment:

- recommended first choice
- but should be bounded with explicit size/runtime guardrails

### Option B: minimal staged ZIP in storage

How it would fit:

- generate ZIP server-side
- upload ZIP to private storage
- return signed URL

Pros:

- easier retry/resume semantics for very large exports

Cons:

- adds extra storage lifecycle and cleanup work
- starts to resemble async export infrastructure
- not currently justified by the repo

Assessment:

- not the preferred first cut
- only worth considering if project-size testing shows direct download is unsafe

### Recommended bounded direction

Use synchronous server-side ZIP generation and direct download in a Node route.

Plan-phase note:

- make the route explicitly Node-oriented
- keep the first version synchronous
- add project-size guardrails rather than invent export jobs/history immediately

## 4. Exported asset file choice

### Current repo support

The repo stores two different image artifacts:

1. original uploaded asset
   - `project-assets` bucket
   - canonical source of truth
2. display derivatives
   - `asset-image-derivatives` bucket
   - lossy JPEG UI artifacts for thumbnail/preview use

### Recommended file choice

Export the original uploaded photo file.

Why:

- originals are preserved intentionally
- display derivatives are for UI only
- derivatives may flatten formats and lose fidelity
- the research goal is a useful project export, not a UI export

What not to use as the main export asset:

- `thumbnail`
- `preview`
- face crop derivatives

Bounded fallback recommendation:

- do not silently substitute a display derivative when the original object is missing
- a missing original storage object should fail the export clearly, because a partial silent replacement weakens auditability

## 5. Recommended asset metadata JSON shape

### Current live data needed

The asset sidecar should reflect current canonical photo-link state:

- face links from `asset_face_consent_links`
- zero-face fallbacks from `asset_consent_manual_photo_fallbacks`
- current consent state from `consents`
- face geometry from `asset_face_materialization_faces`
- materialization metadata from `asset_face_materializations`

### Recommended bounded shape

```json
{
  "assetId": "uuid",
  "assetType": "photo",
  "originalFilename": "DSC001.jpg",
  "contentType": "image/jpeg",
  "fileSizeBytes": 1234567,
  "project": {
    "projectId": "uuid",
    "projectName": "Project Name"
  },
  "uploadedAt": "2026-04-07T12:00:00Z",
  "detectedFaces": [
    {
      "assetFaceId": "uuid",
      "faceRank": 0,
      "boxNormalized": {
        "x_min": 0.1,
        "y_min": 0.2,
        "x_max": 0.3,
        "y_max": 0.5
      },
      "box": {
        "x_min": 123,
        "y_min": 456,
        "x_max": 789,
        "y_max": 1011
      },
      "detectionProbability": 0.99
    }
  ],
  "materialization": {
    "materializationId": "uuid",
    "materializerVersion": "string",
    "sourceImageWidth": 6000,
    "sourceImageHeight": 4000,
    "sourceCoordinateSpace": "oriented_original"
  },
  "linkedConsents": [
    {
      "consentId": "uuid",
      "subjectId": "uuid",
      "fullName": "Tim Uilkema",
      "email": "tim@example.com",
      "currentStatus": "active",
      "revokedAt": null,
      "revokeReason": null,
      "linkMode": "face",
      "linkSource": "manual",
      "assetFaceId": "uuid",
      "faceRank": 0,
      "matchConfidence": null
    }
  ]
}
```

### Why this shape fits the current repo

- `detectedFaces` answers "what faces/boxes are known on this image"
- `linkedConsents` answers "which people/consents are currently linked"
- `linkMode` answers the zero-face fallback case cleanly
- the same shape supports multiple people in one image

### Manual asset-level links when no exact face box is linked

Represent them explicitly as:

- `linkMode: "asset_fallback"`
- `assetFaceId: null`
- `faceRank: null`

This maps directly to `asset_consent_manual_photo_fallbacks`.

### Multiple people in one image

Represent them as:

- multiple `detectedFaces`
- multiple `linkedConsents`
- face links joined by `assetFaceId`

### If no bounding boxes exist

For the zero-face fallback case:

- `detectedFaces: []`
- `materialization.faceCount = 0` if that field is added
- `linkedConsents[*].linkMode = "asset_fallback"`

For truly missing current materialization:

- `detectedFaces: []`
- `materialization: null`

The plan should decide whether to exclude such assets from v1 or export them with empty face metadata.

## 6. Recommended consent JSON shape

### Current live data needed

The consent sidecar can already include:

- consent row fields
- current subject row
- signed legal snapshot
- structured signed snapshot
- current project info
- current linked photo summary

### Recommended bounded shape

```json
{
  "consentId": "uuid",
  "subject": {
    "subjectId": "uuid",
    "fullName": "Tim Uilkema",
    "email": "tim@example.com"
  },
  "project": {
    "projectId": "uuid",
    "projectName": "Project Name"
  },
  "inviteId": "uuid",
  "signedAt": "2026-04-07T12:00:00Z",
  "consentVersion": "v2",
  "consentText": "Signed consent text snapshot",
  "faceMatchOptIn": true,
  "currentStatus": "revoked",
  "revokedAt": "2026-04-08T12:00:00Z",
  "revokeReason": "subject request",
  "structuredFieldsSnapshot": {
    "...": "stored as signed"
  },
  "linkedAssets": [
    {
      "assetId": "uuid",
      "originalFilename": "DSC001.jpg",
      "linkMode": "face",
      "assetFaceId": "uuid",
      "faceRank": 0,
      "linkSource": "auto",
      "matchConfidence": 0.94
    }
  ]
}
```

### Should consent JSON include linked asset references

Recommendation:

- yes, but keep them lightweight

Why:

- it makes the consent file self-explanatory
- it avoids forcing consumers to reverse-index only from asset sidecars
- it stays bounded because the full per-asset metadata still lives in the asset sidecar

### Should signed snapshot data be used where possible

Yes.

Use as primary signed source:

- `consent_text`
- `consent_version`
- `structured_fields_snapshot`

Do not reconstruct these from current template rows.

### How to represent revoked consents safely

Recommendation:

- always export revoked consents
- include both:
  - signed historical data
  - current revocation status

Suggested fields:

- `currentStatus: "active" | "revoked"`
- `revokedAt`
- `revokeReason`

Important note:

- current linked assets may still exist for revoked consents by design
- that is consistent with the repo invariant that revocation stops future processing only

### Important identity caveat

The subject block should be labeled as current staff-visible subject data in the plan, because:

- `full_name` is not snapshotted on `consents`
- it comes from the current `subjects` row

## 7. Naming and folder rules

### Current repo behavior

There is already one simple filename sanitizer in `src/lib/assets/create-asset.ts`:

- replace non `[a-zA-Z0-9._-]` with `_`
- collapse underscores
- trim leading/trailing underscores
- cap length to 120

There is no current general export naming helper.

### Recommended bounded naming rules

Top-level folder:

- safe project name
- fallback to `project_<shortProjectId>` if the sanitized name is empty

Asset file name:

- start with original filename
- sanitize unsafe characters
- preserve extension when possible
- if collision occurs, append `__asset_<shortId>` before the extension

Asset metadata file:

- mirror the final exported asset filename stem
- append `_metadata.json`

Consent JSON file:

- prefer current subject full name
- fallback to email
- fallback to `consent_<shortId>`
- if collision occurs, append `__consent_<shortId>.json`

### Duplicate filenames

These are possible today.

Recommendation:

- resolve collisions deterministically with short stable ID suffixes
- do not rely on ZIP writer overwrite behavior

### Duplicate person names

Also possible today.

Recommendation:

- resolve collisions with consent ID suffixes

### Unsafe filename characters

Recommendation:

- use one shared server-side sanitizer for:
  - top-level project folder
  - asset filenames
  - metadata filenames
  - consent filenames

### Stable collision-safe naming

Recommended principle:

- human-readable first
- stable ID suffix only when needed

This is more readable than always including IDs, while still deterministic.

## 8. Permissions and tenant scoping

### Current repo pattern

Project pages, asset routes, and consent-link routes all:

- authenticate the user
- derive tenant server-side with `resolveTenantId()`
- validate the project inside that tenant
- then often switch to `createAdminClient()` for broader server-side reads

### Current role behavior

The repo does not currently restrict project/asset/consent access by role.

Verified evidence:

- project page shows consent text, subject identity, and headshot previews to any tenant member who can access the project
- asset and consent-link routes check membership, not `owner/admin` only
- only template management currently adds `owner/admin` role checks

### Recommended export permission boundary

Based on current repo patterns:

- allow any authenticated tenant member with project access
- that includes `owner`, `admin`, and `photographer`

Reason:

- this matches existing project detail visibility
- tightening export to owner/admin only would be a new business rule, not a repo-consistent default

### Route shape

Recommended protected route shape:

- `src/app/api/projects/[projectId]/export/route.ts`

Required scoping behavior:

- never accept `tenant_id` from the client
- derive tenant from session
- validate `projectId` against that tenant server-side
- use service-role client only after auth and project scope are validated

## 9. Revocation and current-state semantics

### Current verified invariant

- consent records are never deleted
- revocation stops future processing only

### Current live behavior

- manual photo link/read APIs block new assignments to revoked consents
- auto-reconcile skips revoked consents for new winners
- existing face-link rows can remain for revoked consents
- signed consent snapshots remain intact

### Recommended export semantics

- revoked consents should still be exported
- linked assets should still list revoked consents if they are still linked in current canonical state
- consent JSON should include both:
  - signed historical snapshot data
  - current status metadata

This matches the repo's current audit and revocation model.

## 10. Storage and runtime implications

### Private storage access

Verified current storage model:

- bucket `project-assets` is private
- member select policies exist
- server already uses service-role access for private storage work

### Server-side file reads

Verified current server-side pattern:

- derivative worker downloads original assets with service-role client
- `download()` returns a `Blob`

Export implication:

- the server can read private originals today
- a ZIP route can do the same after authenticating the caller and validating project scope

### Service-role access

Recommendation:

- use `createAdminClient()` inside the export route after auth/project validation

Why:

- current export will need both:
  - tenant-scoped DB reads
  - private storage reads
- admin client is already the repo's standard server-only path for that

### Memory/runtime risks

Main risk factors:

- large original files
- many project assets
- no current ZIP dependency

Bounded observation:

- synchronous ZIP generation is still realistic for small-to-medium projects
- plan phase should define a guardrail for:
  - asset count
  - and/or total bytes

Without guardrails, very large projects may need the staged option later.

## 11. Edge cases

Recommended safe first-version behavior:

- asset with no linked consents
  - export the asset and metadata
  - `linkedConsents: []`

- consent with no linked assets
  - export the consent JSON
  - `linkedAssets: []`

- asset with linked people but no bounding boxes
  - export `detectedFaces: []`
  - export current links with `linkMode: "asset_fallback"`

- revoked consent linked to assets
  - export it
  - include signed snapshot plus revoked status

- duplicate filenames
  - sanitize and add deterministic ID suffix on collision

- duplicate person names
  - sanitize and add deterministic consent ID suffix on collision

- missing storage object for an asset row
  - safest bounded behavior is to fail the export clearly instead of silently producing an incomplete ZIP
  - a partial-success manifest is possible later, but it adds scope

- project with many assets
  - first version should either enforce a bounded sync limit or move to staged ZIP only when those limits are exceeded

## 12. Options considered

### Option 1: export photos plus consent JSON only, all generated synchronously

Pros:

- simplest
- fits current architecture
- no schema changes required

Cons:

- needs a ZIP library
- needs explicit guardrails for project size

Assessment:

- recommended

### Option 2: staged ZIP in storage from day one

Pros:

- better for very large projects

Cons:

- adds async export lifecycle and cleanup immediately
- not justified by current repo evidence

Assessment:

- not recommended for first scope

### Option 3: export display derivatives instead of originals

Pros:

- smaller output
- easier on runtime

Cons:

- loses original fidelity
- conflicts with the repo's preserved-original design
- not a trustworthy first export artifact

Assessment:

- not recommended

## Recommended bounded direction

1. Export one project at a time through a protected Node route.
2. Export only current uploaded `photo` assets in `assets/`.
3. Use the original uploaded file from `project-assets`, not display derivatives.
4. Generate one JSON sidecar per asset and one JSON file per consent.
5. Build asset linkage from:
   - `asset_face_consent_links`
   - plus `asset_consent_manual_photo_fallbacks`
6. Export face boxes only when a current materialization exists.
7. Prefer normalized face boxes plus source image dimensions in the JSON shape.
8. Export revoked consents and revoked current links clearly instead of filtering them out.
9. Include `structured_fields_snapshot` when present.
10. Keep the first version synchronous and add explicit size guardrails instead of async export infrastructure.

## Risks and tradeoffs

- Current subject identity fields are not immutable snapshots.
- `asset_consent_links` is easy to misuse because it still exists but is no longer the canonical photo-link table.
- Missing original storage objects would make silent partial exports misleading.
- Synchronous ZIP generation may not scale to very large projects without limits.
- The repo has no current ZIP dependency, so plan phase must choose one.
- If bounding-box export includes only linked faces and not all detected faces, some downstream consumers may misread the image as fully labeled.

## Explicit open decisions for the plan phase

1. Exact ZIP delivery model
   - direct synchronous response
   - or staged ZIP only when bounded sync limits are exceeded

2. Exact asset metadata JSON shape
   - whether to include both `detectedFaces` and `linkedConsents`
   - or a flatter single `links` array only

3. Exact consent JSON shape
   - especially how much current linked-asset detail to include

4. Whether consent JSON includes linked asset references
   - recommendation: yes, lightweight only

5. Whether bounding boxes include:
   - normalized only
   - or normalized plus raw pixel box

6. Exact permission boundary
   - keep current repo pattern of any project member
   - or introduce a new owner/admin-only rule

7. Exact filename collision rules
   - conditional ID suffixes
   - or always include IDs

8. Exact revoked-consent representation
   - field names and status enum

9. Missing original object behavior
   - fail whole export
   - or allow partial export plus manifest

10. Sync export guardrails
   - max asset count
   - max total bytes
   - or no guardrail in v1

11. Whether to export only current canonical links
   - recommendation: yes
   - do not attempt full historical event reconstruction in v1

12. Whether to include headshots anywhere in the ZIP
   - recommendation: not as exported project assets in v1
   - only expose their relevance indirectly through consent metadata if needed
