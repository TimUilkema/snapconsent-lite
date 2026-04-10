# Feature 043 Plan: Simple Project Export ZIP

## Scope

Deliver a first, bounded project export that lets a staff user download one ZIP for one project.

In scope:

- one project at a time
- one protected export route
- one synchronous downloadable ZIP response
- original uploaded project photo assets only
- one asset metadata JSON sidecar per exported asset
- one consent JSON file per consent/person in the project
- current canonical photo links only
- current face bounding boxes only when available
- structured consent snapshot data when present
- revoked consents exported clearly instead of filtered out

Out of scope:

- async export pipelines
- export history tables
- staged ZIPs in storage by default
- DAM/API export integration
- headshot export as project assets
- historical link/event reconstruction
- reporting/filtering redesign
- revocation enforcement redesign
- schema redesign unless implementation proves one is strictly required

## Inputs And Ground Truth

Inputs re-read for the plan phase, in order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/043-simple-project-export-zip/research.md`

Live implementation boundary re-verified from code and migrations:

- `package.json`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/supabase/admin.ts`
- `src/lib/assets/create-asset.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/face-materialization.ts`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260407213000_042_structured_consent_template_fields.sql`
- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
- `tests/feature-042-structured-consent-template-fields.test.ts`

Verified ground truth:

- tenant scope is derived server-side with `resolveTenantId()`
- project access routes authenticate the user first, then resolve tenant, then validate `project_id`
- private original assets live in `project-assets`
- original asset paths are server-generated in `tenant/<tenantId>/project/<projectId>/asset/<assetId>/<sanitizedName>`
- photo exports must read current canonical links from `asset_face_consent_links` and `asset_consent_manual_photo_fallbacks`
- `asset_consent_links` remains live for headshots and must not be used as the photo-link source for this export
- current face boxes come from `asset_face_materializations` and `asset_face_materialization_faces`
- `consents.structured_fields_snapshot` is live and stores the signed structured snapshot
- consent revocation is current-state metadata on the consent row, not a delete
- no ZIP library is installed today

## Verified Current Boundary

### Current exportable asset boundary

The export will include only `assets` rows that satisfy all of the following:

- `tenant_id = resolvedTenantId`
- `project_id = route projectId`
- `asset_type = 'photo'`
- `status = 'uploaded'`
- `archived_at is null`

The exported file will be the original uploaded object referenced by:

- `storage_bucket`
- `storage_path`

Headshots are explicitly excluded from the project `assets/` export in v1 even though they also live in `assets`.

### Current exportable consent boundary

The export will include one JSON file per consent row in the project:

- `tenant_id = resolvedTenantId`
- `project_id = route projectId`

Implementation should read all project consents ordered by `signed_at asc, created_at asc, id asc` so ZIP contents are deterministic.

### Current canonical photo-link boundary

The export must read current project photo links from:

- `asset_face_consent_links`
- `asset_consent_manual_photo_fallbacks`

The export must not use `asset_consent_links` as the photo-link source.

### Current face metadata boundary

The export will read current face metadata from:

- `asset_face_materializations`
- `asset_face_materialization_faces`

The first version will only export the current materialization state. It will not reconstruct prior materializations or historical link events.

### Current consent snapshot boundary

Signed consent data must come from the consent row:

- `consent_text`
- `consent_version`
- `structured_fields_snapshot`

Current subject identity fields are joined from `subjects` and are not immutable signed identity snapshots.

## Options Considered

### Option A: protected synchronous route with direct ZIP download

Pros:

- fits current Next.js route-handler architecture
- keeps business logic server-side
- avoids async job/history/storage lifecycle work
- keeps the feature small and reviewable

Cons:

- needs a ZIP dependency
- needs explicit size guardrails
- storage read failure during archive build remains a fatal request error

Assessment:

- chosen

### Option B: async staged export job

Pros:

- scales better for large exports
- cleaner retries and history later

Cons:

- requires new lifecycle state, cleanup, and UX
- exceeds the bounded v1 scope

Assessment:

- rejected for Feature 043

### Option C: staged ZIP object in storage without jobs

Pros:

- improves retry/download reliability for large payloads

Cons:

- still adds lifecycle and cleanup complexity
- starts to resemble export infrastructure
- not justified by the current repo

Assessment:

- rejected for Feature 043

### Option D: derivative-based asset export

Pros:

- smaller files

Cons:

- not the source-of-truth asset
- can be lossy and format-flattened
- conflicts with the requested scope

Assessment:

- rejected for Feature 043

## Recommendation

Implement one protected Node route at `src/app/api/projects/[projectId]/export/route.ts` that:

- authenticates the user
- resolves tenant membership server-side
- validates project scope server-side
- reads canonical project export data from current DB tables
- downloads original photo assets from private storage
- generates one ZIP directly in the request
- returns it as an attachment

This version will stay synchronous, direct-download only, and guarded by explicit limits instead of adding async export infrastructure.

## Chosen Architecture

The chosen design for Feature 043 is:

- one protected Node route under the project API surface
- synchronous ZIP generation and direct download
- original project photo reads from private Supabase Storage
- canonical metadata reads from existing DB tables
- no schema changes
- no background jobs
- no export history
- no staging ZIP in storage by default
- no derivative-based asset export

## Exact Route And Delivery Model

### Route

`src/app/api/projects/[projectId]/export/route.ts`

### Request model

- method: `GET`
- auth required: yes
- client input accepted: only `projectId` from route params
- tenant input accepted from client: no

### Scope resolution flow

1. Create authenticated server client with `createClient()`.
2. Read the current user with `supabase.auth.getUser()`.
3. Resolve tenant with `resolveTenantId(authSupabase)`.
4. Validate that the project exists in that tenant before any broad reads.
5. After auth and project scope are validated, switch to `createAdminClient()` for the export query set and private storage downloads.
6. Keep explicit `tenant_id` and `project_id` filters on every admin query.

### Runtime and caching

- `export const runtime = "nodejs"`
- `export const dynamic = "force-dynamic"`
- response should include `Cache-Control: no-store`

### ZIP library

Add dependency:

- `archiver`

Why:

- good fit for a Node route
- supports streaming cleanly
- can append Buffers, strings, and Node readable streams
- widely used and simple for a bounded ZIP response

### Response model

Success response:

- status `200`
- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="<safe-project-folder>.zip"`

Error responses before ZIP generation starts:

- `401 unauthenticated`
- `403 no_tenant_membership`
- `404 project_not_found`
- `413 project_export_too_large`
- `500 project_export_failed`
- `500 project_export_asset_missing`

### Stream vs buffer decision

The ZIP will be streamed, not fully buffered.

Implementation shape:

- create a Node `PassThrough`
- pipe `archiver("zip", { zlib: { level: 9 } })` into it
- return `new Response(Readable.toWeb(passThrough), { headers })`

Reason:

- avoids holding the full ZIP in memory
- still satisfies the synchronous direct-download scope

### Guardrails

Before archive generation starts, the route will enforce:

- maximum exported photo count: `200`
- maximum total exported photo bytes: `500 * 1024 * 1024` bytes

If either limit is exceeded, return:

- status `413`
- error code `project_export_too_large`
- message stating that the project exceeds the synchronous export limit

No partial ZIP is returned for guardrail failures.

## Exact Export Contents

### ZIP layout

```text
<project_folder>/
  assets/
    <asset-file>
    <asset-file-stem>_metadata.json
  consent_forms/
    <consent-file>.json
```

### Assets folder contents

For each qualifying photo asset:

- original uploaded file from `project-assets`
- one metadata sidecar JSON file

Qualifying asset row requirements:

- `asset_type = 'photo'`
- `status = 'uploaded'`
- `archived_at is null`
- `storage_bucket` and `storage_path` are both non-null

If a row qualifies by status but is missing storage coordinates, treat it as a fatal export error.

### Consent forms folder contents

For each project consent:

- one JSON file per consent/person

Revoked consents are included.

### Explicit exclusions

Not exported in v1:

- headshot files
- display derivatives
- face crop derivative images
- legacy link history
- suppressions tables as first-class export files

## Exact Asset Metadata JSON Shape

The first-cut asset sidecar will use this shape:

```json
{
  "schemaVersion": 1,
  "assetId": "uuid",
  "assetType": "photo",
  "originalFilename": "DSC001.jpg",
  "exportedFilename": "DSC001.jpg",
  "metadataFilename": "DSC001_metadata.json",
  "contentType": "image/jpeg",
  "fileSizeBytes": 1234567,
  "uploadedAt": "2026-04-07T12:00:00Z",
  "project": {
    "projectId": "uuid",
    "projectName": "Project Name"
  },
  "materialization": {
    "materializationId": "uuid",
    "materializerVersion": "string",
    "provider": "string",
    "providerMode": "string",
    "faceCount": 2,
    "sourceImageWidth": 6000,
    "sourceImageHeight": 4000,
    "sourceCoordinateSpace": "oriented_original"
  },
  "detectedFaces": [
    {
      "assetFaceId": "uuid",
      "faceRank": 0,
      "detectionProbability": 0.99,
      "boxNormalized": {
        "x_min": 0.1,
        "y_min": 0.2,
        "x_max": 0.3,
        "y_max": 0.5,
        "probability": 0.99
      },
      "boxPixels": {
        "x_min": 123,
        "y_min": 456,
        "x_max": 789,
        "y_max": 1011,
        "probability": 0.99
      },
      "linkedConsentId": "uuid",
      "linkSource": "manual",
      "matchConfidence": null
    }
  ],
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

### Asset JSON decisions

Chosen decisions for v1:

- include both normalized and raw pixel boxes when available
- include all detected faces from the current materialization, not only linked faces
- `materialization` is `null` when no current materialization exists
- `detectedFaces` is `[]` when there is no current materialization or the current materialization has zero faces
- `linkedConsents` is `[]` when the asset has no current links
- zero-face manual links are represented with:
  - `linkMode: "asset_fallback"`
  - `linkSource: "manual"`
  - `assetFaceId: null`
  - `faceRank: null`
  - `matchConfidence: null`

### Link semantics in asset JSON

`linkedConsents` is the canonical current-link summary for downstream consumers.

`detectedFaces` answers a separate question:

- which faces currently exist on this image
- whether each current face is linked

If a detected face is currently unlinked:

- `linkedConsentId: null`
- `linkSource: null`
- `matchConfidence: null`

## Exact Consent JSON Shape

The first-cut consent export will use this shape:

```json
{
  "schemaVersion": 1,
  "consentId": "uuid",
  "project": {
    "projectId": "uuid",
    "projectName": "Project Name"
  },
  "subject": {
    "subjectId": "uuid",
    "fullName": "Tim Uilkema",
    "email": "tim@example.com",
    "source": "current_subject_record"
  },
  "inviteId": "uuid",
  "signedAt": "2026-04-07T12:00:00Z",
  "signedSnapshot": {
    "consentVersion": "v2",
    "consentText": "Signed consent text snapshot",
    "structuredFieldsSnapshot": {
      "...": "stored as signed"
    }
  },
  "faceMatchOptIn": true,
  "currentStatus": {
    "state": "revoked",
    "revokedAt": "2026-04-08T12:00:00Z",
    "revokeReason": "subject request"
  },
  "linkedAssets": [
    {
      "assetId": "uuid",
      "originalFilename": "DSC001.jpg",
      "exportedFilename": "DSC001.jpg",
      "linkMode": "face",
      "linkSource": "auto",
      "assetFaceId": "uuid",
      "faceRank": 0,
      "matchConfidence": 0.94
    }
  ]
}
```

### Consent JSON decisions

Chosen decisions for v1:

- use signed snapshot fields from the consent row wherever possible
- keep current status separate from signed snapshot data
- include lightweight linked asset references
- keep subject identity fields as current joined subject values
- label subject values with `source: "current_subject_record"` to avoid implying immutable signed identity snapshots

### Linked asset reference scope

`linkedAssets` will stay lightweight and include only:

- `assetId`
- `originalFilename`
- `exportedFilename`
- `linkMode`
- `linkSource`
- `assetFaceId`
- `faceRank`
- `matchConfidence`

It will not duplicate per-asset face boxes or materialization metadata.

### Structured snapshot behavior

`signedSnapshot.structuredFieldsSnapshot` will be:

- the stored `consents.structured_fields_snapshot` object when present
- `null` when the consent predates structured fields or the template had no structured fields

## Current Canonical Data Sources

The implementation must anchor to these live sources:

### Projects

- `projects`

### Exported assets

- `assets`

### Exported consents

- `consents`
- joined `subjects`

### Current canonical photo links

- `asset_face_consent_links`
- `asset_consent_manual_photo_fallbacks`

### Current face boxes and materialization metadata

- `asset_face_materializations`
- `asset_face_materialization_faces`

### Explicit non-source for photo links

Do not read project photo links from:

- `asset_consent_links`

That table remains relevant for headshots, not project photo export.

## Naming And ZIP Path Rules

### Shared sanitizer

Create one export naming helper that:

- replaces characters outside `[A-Za-z0-9._-]` with `_`
- collapses repeated `_`
- trims leading and trailing `_`, `.`, and spaces
- caps the stem length at `120`
- rejects `.` and `..` by falling back to a generated name

### Top-level project folder

Rule:

- use sanitized project name
- if empty after sanitization, use `project_<shortProjectId>`

The download filename will be `<project_folder>.zip`.

### Asset filenames

Rule:

- start from `original_filename`
- sanitize while preserving the last extension when present
- if the sanitized stem is empty, use `asset_<shortAssetId>`
- if the final candidate collides with an earlier asset filename, append `__asset_<shortAssetId>` before the extension

Examples:

- `DSC001.jpg`
- `DSC001__asset_a1b2c3d4.jpg`
- `asset_a1b2c3d4.jpg`

### Asset metadata filenames

Rule:

- use the final exported asset filename stem
- append `_metadata.json`

Examples:

- `DSC001_metadata.json`
- `DSC001__asset_a1b2c3d4_metadata.json`

### Consent JSON filenames

Rule:

- prefer sanitized subject full name
- fallback to sanitized subject email
- fallback to `consent_<shortConsentId>`
- append `.json`
- if the filename collides, append `__consent_<shortConsentId>.json`

Examples:

- `Tim_Uilkema.json`
- `Tim_Uilkema__consent_a1b2c3d4.json`
- `consent_a1b2c3d4.json`

### Collision decision

ID suffixes are conditional, not always included.

Reason:

- keeps common exports readable
- remains deterministic and collision-safe

## Revocation And State Semantics

Feature 043 will preserve the current consent invariants exactly:

- revoked consents are still exported
- linked assets may still list revoked consents if they are currently linked in canonical state
- consent JSON includes both signed historical snapshot data and current status fields

Representation decision:

- active consent: `currentStatus.state = "active"`
- revoked consent: `currentStatus.state = "revoked"`
- revocation timestamp: `currentStatus.revokedAt`
- revocation reason: `currentStatus.revokeReason`

No revocation redesign is part of this feature.

## Missing Data And Failure Behavior

### Asset with no linked consents

Behavior:

- export the original file
- export sidecar JSON
- set `linkedConsents: []`

### Consent with no linked assets

Behavior:

- export the consent JSON
- set `linkedAssets: []`

### Asset with no face boxes

Behavior:

- if a current materialization exists with zero faces, export `materialization.faceCount = 0` and `detectedFaces: []`
- if no current materialization exists, export `materialization: null` and `detectedFaces: []`

### Asset with fallback manual links only

Behavior:

- export `detectedFaces: []`
- export `linkedConsents` entries with `linkMode: "asset_fallback"`

### Missing original storage object

Behavior:

- fail the entire export
- do not silently skip the asset
- do not substitute a derivative

Response target:

- error code `project_export_asset_missing`
- message stating that one or more original project assets are missing

Implementation note:

- because the response is streamed, a late storage failure will abort the download rather than return a partial successful ZIP
- this is acceptable for the bounded v1 and should be logged clearly server-side

### Missing or null structured snapshot

Behavior:

- export `signedSnapshot.structuredFieldsSnapshot: null`

### Duplicate filenames

Behavior:

- resolve deterministically with the collision rules above

### Project too large for synchronous export

Behavior:

- fail before ZIP generation starts
- return `413 project_export_too_large`
- do not produce a partial export

## Storage And Server Access Model

### DB reads

Use two clients:

- authenticated server client for auth and initial tenant/project validation
- admin client for export reads after scope validation

### Private storage reads

Use `createAdminClient()` for private original asset downloads from `project-assets`.

Reason:

- export route needs server-side access to private originals
- this matches the existing worker and server patterns

### Scope discipline

Required order:

1. authenticate caller
2. resolve tenant membership
3. validate project membership/scope
4. only then issue broader admin reads and storage downloads

### Path exposure

Do not expose internal storage paths in exported JSON.

Exported JSON should contain public export-oriented metadata only, not internal bucket/path references.

## Permissions

The export permission boundary for Feature 043 will match current project access behavior:

- any authenticated tenant member with access to the project may export it

Included roles:

- owner
- admin
- photographer

Reason:

- this matches existing project detail visibility and project asset/consent route patterns
- narrowing export to owner/admin only would introduce a new business rule not supported by current repo behavior

## Security And Reliability Considerations

- never accept `tenant_id` from the client
- never trust client ownership claims
- keep all export shaping server-side
- filter every admin query by both `tenant_id` and `project_id`
- validate project scope before admin reads and storage access
- do not expose service-role credentials to the client
- do not substitute derivatives for missing originals
- do not filter revoked consents out of the export
- do not reconstruct historical links for v1
- keep filename sanitization shared and deterministic
- order exported records deterministically so repeated exports are stable

## Compatibility And Failure Behavior

This plan is compatible with the current live model because it extends existing routes and tables rather than replacing them.

No migration is planned.

Known bounded tradeoffs:

- current subject identity values are export-time joins, not immutable signed identity snapshots
- late storage failures during a streamed response abort the download
- very large projects are intentionally rejected instead of introducing async export infrastructure

## Test Plan

Add focused tests for the new export helpers and route.

### Unit or helper-level coverage

- filename sanitization and collision handling for assets
- filename sanitization and collision handling for consents
- asset metadata shaping with:
  - face links
  - fallback manual links
  - multiple faces
  - no links
  - no materialization
- consent JSON shaping with:
  - active consent
  - revoked consent
  - structured snapshot present
  - structured snapshot null
  - linked assets
  - no linked assets

### Route or integration coverage

- unauthenticated request returns `401`
- user without tenant membership returns `403`
- cross-tenant or missing project returns `404`
- authenticated photographer-level member can export successfully
- ZIP contains:
  - top-level project folder
  - `assets/`
  - `consent_forms/`
- ZIP contains original photo files, not derivatives
- every exported photo gets one metadata sidecar
- every project consent gets one consent JSON
- revoked consent appears in consent export and asset linked-consent summaries
- structured snapshot is included when present
- assets with no links still export with `linkedConsents: []`
- consents with no linked assets still export with `linkedAssets: []`
- canonical current links come from:
  - `asset_face_consent_links`
  - `asset_consent_manual_photo_fallbacks`
- legacy `asset_consent_links` photo data is ignored
- face boxes are included only when current materialization exists
- duplicate asset filenames are resolved deterministically
- duplicate subject names are resolved deterministically
- missing original storage object fails the export
- guardrail breach returns `413 project_export_too_large`

### Practical ZIP assertion strategy

Use the test suite to:

- call the route handler directly
- read the returned ZIP bytes
- inspect entry names and JSON payloads with a ZIP reader suitable for tests

If adding a ZIP reader just for tests is too heavy, isolate archive-building helpers so entry names and JSON payloads can be asserted before archive assembly, then keep one thinner route-level success test.

## Implementation Phases

### Phase 1: export shaping helpers and naming helpers

- add shared export filename sanitizer and collision resolver
- add data-loading helpers for:
  - exportable project assets
  - project consents
  - current canonical photo links
  - current face materialization data
- add asset metadata JSON shaper
- add consent JSON shaper
- add targeted helper tests

### Phase 2: protected export route and ZIP generation

- add `src/app/api/projects/[projectId]/export/route.ts`
- implement auth, tenant resolution, and project scope validation
- implement guardrail checks
- add `archiver`
- stream the ZIP response with original asset files plus shaped JSON files

### Phase 3: route tests, failure handling, and cleanup

- add route/integration coverage for permissions, ZIP structure, revoked data, and guardrails
- tighten error shaping for missing-object and too-large failures
- extract any small reusable helpers if route size grows too much

## Scope Boundaries

Feature 043 must remain bounded.

Explicitly out of scope:

- async export pipelines
- export history tables
- storage-staged ZIP lifecycle by default
- DAM/API connectors
- headshot export as project assets
- historical link/event replay
- reporting/filtering redesign
- revocation enforcement redesign
- subject identity snapshot redesign

## Concise Implementation Prompt

Implement Feature 043 as a small, server-only Next.js Node route at `src/app/api/projects/[projectId]/export/route.ts`. Authenticate the caller, resolve `tenant_id` server-side, validate project scope before any admin reads, then use `createAdminClient()` to load current project photo assets, current project consents, current canonical photo links from `asset_face_consent_links` and `asset_consent_manual_photo_fallbacks`, and current face data from `asset_face_materializations` plus `asset_face_materialization_faces`. Export original uploaded `photo` assets only from `project-assets`, generate one asset sidecar JSON and one consent JSON per project consent using the exact shapes in this plan, include revoked consents and structured snapshots, sanitize filenames deterministically with collision-safe suffixes, enforce the synchronous guardrails, and stream one ZIP attachment directly with `archiver`. Do not add async jobs, history tables, DAM connectors, derivative exports, headshot exports, or schema changes unless a blocking implementation issue proves they are strictly required.
