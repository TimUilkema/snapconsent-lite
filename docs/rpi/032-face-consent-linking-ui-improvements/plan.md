# Feature 032 Plan: Face Consent Linking UI Improvements

## Inputs And Ground Truth

This plan is based on:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.MD`
- `docs/rpi/README.md`
- verified research in `docs/rpi/032-face-consent-linking-ui-improvements/research.md`
- Feature 031 research and plan:
  - `docs/rpi/031-one-consent-per-face-precedence-rules/research.md`
  - `docs/rpi/031-one-consent-per-face-precedence-rules/plan.md`

Repository code and schema are the source of truth. This plan is grounded in the verified current implementation in:

- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/components/projects/photo-link-review-dialog.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state/route.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/providers/compreface.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/components/projects/project-matching-progress.tsx`
- `src/components/projects/assets-upload-form.tsx`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`

Feature 031 canonical semantics are fixed plan boundaries for this feature:

- detected-face canonical ownership stays in `asset_face_consent_links`
- face-level suppressions stay in `asset_face_consent_link_suppressions`
- zero-face fallback stays separate in `asset_consent_manual_photo_fallbacks`
- manual-over-auto and per-face exclusivity do not change
- same-consent-on-multiple-faces-in-one-asset remains deferred

## Verified Current Boundary

Feature 032 is a UI and operator-workflow feature, not a precedence-model feature.

Current verified limitations:

- manual review is single-asset only
- there is no resumable bulk review session
- `manual-link-state` is now a real server-side materialization path, so broad prefetch is unsafe
- face crops do not exist
- overlay boxes are rendered from a mismatched coordinate space
- the dialog does not expose queue progress, retryable states, or strong face-specific context

Current verified strengths to reuse:

- server-side manual link/unlink logic in `photo-face-linking.ts`
- tenant/project/consent/asset validation is already server-side
- zero/one/multi-face rules are already enforced server-side
- revoked consent is already blocked server-side
- face materialization and current-materialization checks already exist

## Options Considered

### Option A: Client-only bulk review on top of existing single-asset APIs

Pros:

- smallest initial surface
- minimal schema work

Cons:

- weak refresh/resume behavior
- duplicate prepare/confirm handling becomes client orchestration
- harder to reconcile pending materialization, rematerialization, and concurrent-user conflicts
- no durable place to track queue progress or blocked items

### Option B: Durable server-backed review session plus additive review read models

Pros:

- server owns classification, retries, and partial failures
- refresh/navigation resume is straightforward
- duplicate prepare requests can safely reuse the current session
- item-level conflicts and revocations can be surfaced cleanly
- keeps manual write semantics centralized in `photo-face-linking.ts`

Cons:

- requires new schema and orchestration helpers
- slightly larger than a client-only queue

### Option C: Visual-only dialog improvements without bulk orchestration

Pros:

- smallest UI diff

Cons:

- does not solve operator throughput
- leaves repeated open/save/close loops for every asset

## Recommendation

Choose **Option B**.

The chosen architecture is:

- add a durable server-backed review session per user and consent
- keep one active session per `(tenant_id, project_id, consent_id, created_by_user_id)`
- use the session prepare step to classify the selected asset batch server-side
- immediately complete safe zero-face and one-face items server-side
- place multi-face items into a sequential review queue
- keep pending-materialization items in the session and reconcile them on session reads
- add private face crop derivatives tied to current `asset_face_materialization_faces.id`
- add an explicit normalized overlay coordinate contract and render overlays against the actual displayed image box
- extend the existing panel/dialog instead of redesigning the shell

This keeps Feature 031 semantics unchanged while making operator review materially faster and resumable.

## Chosen Architecture

### 1. Bulk manual linking uses a durable server-backed review session

Feature 032 will add a review-session model for one consent at a time.

Session scope:

- one active session per user per consent
- different users may each have their own active session for the same consent
- duplicate prepare requests from the same user for the same consent will reuse the current open session when the selected asset set matches
- a new prepare request with a different asset set will close the previous open session for that same user+consent and create a new one

This choice is preferred over one global session per consent because:

- review progress is operator-specific
- different operators may need to work independently
- a global session would create unnecessary cross-user contention

### 2. Session lifecycle

Session states:

- `open`
- `completed`
- `cancelled`
- `expired`

Session item states:

- `pending_materialization`
- `ready_for_face_selection`
- `completed`
- `blocked`

Completed result kinds:

- `linked_face`
- `linked_fallback`
- `suppressed_face`

Blocked codes:

- `consent_revoked`
- `manual_conflict`
- `asset_unavailable`
- `materialization_failed`

Lifecycle:

1. user selects assets and submits bulk review
2. server validates consent/project/tenant and creates or reuses an `open` session
3. server creates session items in deterministic asset order
4. server classifies each item against current materialization state
5. session reads reconcile pending items and rematerialized items
6. multi-face queue items are completed by explicit per-item session actions
7. session auto-completes when no `pending_materialization` or `ready_for_face_selection` items remain
8. sessions expire after inactivity and are hard-deleted later because canonical link history already lives elsewhere

Cleanup strategy:

- store `expires_at`
- refresh `last_accessed_at` and `expires_at` on session read/action
- opportunistically delete expired sessions during create/read paths
- later scheduled cleanup may hard-delete expired rows, but implementation should not depend on a scheduler to remain correct

### 3. Per-item classification and progression

Prepare-time classification rules:

- if the consent is revoked:
  - fail the whole prepare request with `409 consent_revoked`
- if no asset IDs are provided:
  - fail with `400 invalid_asset_ids`
- for each valid project photo asset:
  - if no current materialization exists:
    - enqueue `materialize_asset_faces` with `repair_requeue`
    - create `pending_materialization` item
  - if current materialization exists with `face_count = 0`:
    - call `manualLinkPhotoToConsent(... mode: "asset_fallback")`
    - create `completed: linked_fallback`
  - if current materialization exists with `face_count = 1`:
    - call `manualLinkPhotoToConsent(... mode: "face")` without `assetFaceId`
    - create `completed: linked_face`
  - if current materialization exists with `face_count > 1`:
    - create `ready_for_face_selection`
    - store the prepared materialization id and detected face count

Read-time reconciliation rules:

- re-check `pending_materialization` items against current materialization
- when a pending item becomes ready:
  - re-run the same zero/one/multi-face classification idempotently
- re-check `ready_for_face_selection` items against current materialization
- if the prepared materialization id is no longer current:
  - reload current faces
  - update stored prepared materialization id and face count
  - clear any stale selected face in session state
  - surface `wasRematerialized: true` on that item in the read response
- because the current repo updates materialization rows in place for the same `(asset_id, materializer_version)`, implementation may also detect rematerialization via a newer `materialized_at` or changed face count relative to the session item's last reconcile timestamp
- do not silently force a new face selection for multi-face items

This keeps the session convergent with current Feature 031 truth without changing canonical ownership rules.

### 4. Duplicate prepare and confirm safety

Prepare safety:

- compute `selection_hash` from the sorted unique asset IDs server-side
- if an open session already exists for `(tenant_id, project_id, consent_id, created_by_user_id, selection_hash)`, return it
- if an open session exists for the same user+consent with a different `selection_hash`, mark it `cancelled` and create a new one

Item action safety:

- per-item actions always reuse `manualLinkPhotoToConsent(...)` and `manualUnlinkPhotoFromConsent(...)`
- repeated action requests for the same item are safe because the underlying write paths are already idempotent or conflict-aware
- session item updates should use `session_id + item_id` scoped updates and re-read the canonical current state before returning

### 5. Face crop thumbnails use a dedicated derivative table

Feature 032 will add a dedicated private derivative table rather than storing crop metadata directly on `asset_face_materialization_faces`.

Chosen model:

- new table: `asset_face_image_derivatives`
- key fields:
  - `id`
  - `asset_face_id`
  - `materialization_id`
  - `asset_id`
  - `tenant_id`
  - `project_id`
  - `derivative_kind`
  - `storage_bucket`
  - `storage_path`
  - `width`
  - `height`
  - `created_at`
- unique constraint:
  - `(asset_face_id, derivative_kind)`

Chosen derivative kind for 032:

- one review crop variant only, for example `review_square_256`

Why a dedicated table is preferred:

- keeps the face row focused on matching evidence
- gives a clean home for future derivatives without face-row bloat
- makes invalidation/versioning explicit

### 6. Crop generation timing

Chosen timing:

- generate review crops inline as part of face materialization persistence

Reason:

- single-asset manual review should have crops immediately when materialization succeeds
- bulk background materialization is already asynchronous, so extra crop work does not block the web request path there
- this is simpler than introducing a second derivative queue for Feature 032

Bounded constraint:

- generate only one crop size for 032
- treat crop generation failure as non-fatal to the materialization itself
- if crop generation fails, the UI falls back to full-photo review without crop thumbnails and the item exposes a safe degraded state

### 7. Storage path and signing behavior for crops

Chosen storage model:

- use a dedicated private bucket, for example `asset-face-derivatives`
- storage path convention:
  - `tenant/{tenantId}/project/{projectId}/materialization/{materializationId}/face/{assetFaceId}/review-square-256.webp`

Read behavior:

- crop URLs are signed server-side on read
- signed URLs remain short-lived
- session rows store identifiers and storage paths, not signed URLs
- stale signed URLs are recovered by re-reading the session or single-asset review state

Invalidation/versioning:

- crop rows are keyed to `asset_face_id`
- old derivatives naturally become obsolete when a new current materialization replaces the face rows
- foreign keys with `on delete cascade` keep cleanup explicit when old face rows are removed

### 8. Overlay coordinate contract

Feature 032 will define an explicit overlay contract and stop relying on provider-space pixel boxes in the UI.

Chosen canonical render contract:

- store face boxes in normalized coordinates relative to the oriented original image space
- store the source image dimensions used for that normalized space on the materialization row

Schema additions:

- on `asset_face_materializations`:
  - `source_image_width integer`
  - `source_image_height integer`
  - `source_coordinate_space text default 'oriented_original'`
- on `asset_face_materialization_faces`:
  - `face_box_normalized jsonb`

Compatibility:

- keep the existing `face_box` field as provider/raw compatibility data for now
- stop using `face_box` for new UI rendering

Provider mapping requirement:

- if CompreFace preprocessing rotates or resizes the image before detection, map provider boxes back into oriented original-image space before computing `face_box_normalized`

Client render contract:

- render the image in a measured inner box that matches the actual displayed image area after `object-fit: contain`
- position overlays relative to that inner image box, not the outer wrapper
- use normalized box values to compute left/top/width/height percentages inside that measured box

This is the fix for today’s misalignment issue.

## Schema Changes

### 1. Review session tables

Add:

- `face_review_sessions`
- `face_review_session_items`

`face_review_sessions` fields:

- `id uuid primary key`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `consent_id uuid not null`
- `created_by uuid not null`
- `selection_hash text not null`
- `status text not null check (status in ('open','completed','cancelled','expired'))`
- `selected_asset_count integer not null`
- `expires_at timestamptz not null`
- `last_accessed_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints and indexes:

- foreign keys to tenant/project/consent/user scope
- partial unique index for one open session per `(tenant_id, project_id, consent_id, created_by)`
- lookup index on `(tenant_id, project_id, consent_id, created_by, status)`

`face_review_session_items` fields:

- `id uuid primary key`
- `session_id uuid not null`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `consent_id uuid not null`
- `asset_id uuid not null`
- `position integer not null`
- `status text not null check (status in ('pending_materialization','ready_for_face_selection','completed','blocked'))`
- `completion_kind text null check (completion_kind in ('linked_face','linked_fallback','suppressed_face'))`
- `block_code text null check (block_code in ('consent_revoked','manual_conflict','asset_unavailable','materialization_failed'))`
- `prepared_materialization_id uuid null`
- `selected_asset_face_id uuid null`
- `detected_face_count integer null`
- `last_reconciled_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints and indexes:

- unique `(session_id, asset_id)`
- index for queue order `(session_id, position)`
- lookup indexes by `(tenant_id, project_id, consent_id, status)`

### 2. Face crop derivative table

Add:

- `asset_face_image_derivatives`

Fields:

- `id uuid primary key`
- `asset_face_id uuid not null`
- `materialization_id uuid not null`
- `asset_id uuid not null`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `derivative_kind text not null`
- `storage_bucket text not null`
- `storage_path text not null`
- `width integer not null`
- `height integer not null`
- `created_at timestamptz not null default now()`

Constraints:

- unique `(asset_face_id, derivative_kind)`
- foreign keys with `on delete cascade` to current face/materialization scope

### 3. Materialization geometry metadata

Add:

- `asset_face_materializations.source_image_width`
- `asset_face_materializations.source_image_height`
- `asset_face_materializations.source_coordinate_space`
- `asset_face_materialization_faces.face_box_normalized`

## API Changes

### 1. Bulk session prepare

Add:

- `POST /api/projects/[projectId]/consents/[consentId]/review-sessions`

Request body:

```json
{
  "assetIds": ["uuid", "uuid"]
}
```

Response `200`:

```json
{
  "session": {
    "id": "uuid",
    "status": "open",
    "selectedAssetCount": 12,
    "completedCount": 7,
    "pendingMaterializationCount": 2,
    "readyForFaceSelectionCount": 3,
    "blockedCount": 0,
    "nextReviewItemId": "uuid-or-null",
    "reusedExistingSession": false
  }
}
```

Response `400`:

```json
{
  "error": "invalid_asset_ids",
  "message": "Select at least one project photo."
}
```

Response `409`:

```json
{
  "error": "consent_revoked",
  "message": "Revoked consents cannot be linked to photos."
}
```

Server behavior:

- derive auth and tenant server-side
- validate consent belongs to project/tenant
- validate asset IDs belong to the same project/tenant and are photos
- do not trust any client-provided tenant id
- create or reuse the session
- classify items using current Feature 031 helpers

### 2. Resume current session

Add:

- `GET /api/projects/[projectId]/consents/[consentId]/review-sessions/current`

Response `200`:

- returns the active session read model for the current user+consent

Response `404`:

```json
{
  "error": "review_session_not_found",
  "message": "No active review session exists."
}
```

This is the refresh/resume entry point.

### 3. Session read

Add:

- `GET /api/projects/[projectId]/consents/[consentId]/review-sessions/[sessionId]`

Response shape:

```json
{
  "session": {
    "id": "uuid",
    "status": "open",
    "selectedAssetCount": 12,
    "completedCount": 7,
    "pendingMaterializationCount": 2,
    "readyForFaceSelectionCount": 3,
    "blockedCount": 0,
    "currentQueueIndex": 1,
    "nextReviewItemId": "uuid-or-null"
  },
  "items": [
    {
      "id": "uuid",
      "assetId": "uuid",
      "position": 1,
      "status": "ready_for_face_selection",
      "completionKind": null,
      "blockCode": null,
      "preparedMaterializationId": "uuid",
      "detectedFaceCount": 3,
      "wasRematerialized": false,
      "asset": {
        "originalFilename": "group.jpg",
        "thumbnailUrl": "signed-url-or-null",
        "previewUrl": "signed-url-or-null"
      },
      "faces": [
        {
          "assetFaceId": "uuid",
          "faceRank": 0,
          "faceBoxNormalized": {
            "x_min": 0.11,
            "y_min": 0.20,
            "x_max": 0.33,
            "y_max": 0.55
          },
          "cropUrl": "signed-url-or-null",
          "status": "available",
          "currentAssignee": null,
          "isCurrentConsentFace": false,
          "isSuppressedForConsent": false
        }
      ]
    }
  ]
}
```

Read behavior:

- re-sign all preview and crop URLs
- reconcile pending items
- reconcile rematerialized items
- do not expose raw internal materializer/provider errors

### 4. Session item action endpoint

Add:

- `POST /api/projects/[projectId]/consents/[consentId]/review-sessions/[sessionId]/items/[itemId]/actions`

Supported actions:

```json
{
  "action": "link_face",
  "assetFaceId": "uuid",
  "forceReplace": false
}
```

```json
{
  "action": "suppress_face",
  "assetFaceId": "uuid"
}
```

Response `200`:

```json
{
  "ok": true,
  "item": {
    "id": "uuid",
    "status": "completed",
    "completionKind": "linked_face"
  },
  "session": {
    "nextReviewItemId": "uuid-or-null",
    "completedCount": 8,
    "readyForFaceSelectionCount": 2,
    "pendingMaterializationCount": 2
  }
}
```

Response `409` for manual conflict:

```json
{
  "ok": false,
  "error": "manual_conflict",
  "message": "This face is already manually assigned to another consent.",
  "canForceReplace": true,
  "currentAssignee": {
    "consentId": "uuid",
    "fullName": "Name",
    "email": "person@example.com",
    "linkSource": "manual"
  }
}
```

Other conflict/error codes to preserve:

- `consent_revoked`
- `invalid_asset_face_id`
- `photo_materialization_pending`
- `photo_face_selection_required`
- `photo_zero_faces_only_fallback`
- `review_session_expired`
- `review_session_not_found`

Action behavior:

- `link_face` reuses `manualLinkPhotoToConsent(...)`
- `suppress_face` reuses `manualUnlinkPhotoFromConsent(...)` with face mode
- responses remain tenant-scoped and server-validated

### 5. Single-asset review route additions

Keep:

- `GET /api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state`

Additive response fields only:

- `faces[].cropUrl`
- `faces[].status`
- `faces[].faceBoxNormalized`
- `materializationStatus` may gain a safe `failed` state only if implementation can distinguish retryable failures without leaking provider internals

This lets the existing single-asset dialog benefit from 032 improvements without changing its route contract fundamentally.

## UI Changes

### 1. Consent asset matching panel

Update `src/components/projects/consent-asset-matching-panel.tsx` to add:

- multi-select checkboxes in the matchable list
- a bulk review action for selected assets
- resume-current-session behavior when an open session exists
- clearer likely-match cues, including reusing `candidateAssetFaceId` / `candidateFaceRank`
- linked section previews that show linked face crops when available

Bounded UX rules:

- keep the existing panel structure
- do not redesign the app shell
- keep controls plain and functional per `UNCODEXIFY.MD`

### 2. Review dialog

Extend `src/components/projects/photo-link-review-dialog.tsx` to support:

- both single-asset review and session-backed queue review
- full photo preview with corrected overlays
- face chips/crops beside the full photo
- per-face badges:
  - `Current`
  - `Available`
  - `Occupied manual`
  - `Occupied auto`
  - `Suppressed`
- selected-face detail state
- next/previous queue controls
- progress indicator:
  - current item index
  - remaining items
  - pending materialization count
- retryable/blocked/error states
- mobile-safe stacked layout
- minimal keyboard ergonomics:
  - left/right or up/down to change selected face
  - enter to confirm the current face
  - escape to close

### 3. Related improvements included in scope

Included in Feature 032:

- show linked face crops in the “already linked” section when available
- allow direct “suppress for this consent” from the face picker by calling the existing face-level unlink/suppression logic
- show clearer manual/auto/occupied/suppressed states
- let one-face assets skip extra review friction by auto-linking during session prepare/reconcile
- preserve review queue state across refresh/navigation via the server-backed session

Not included in Feature 032:

- broad shell redesign
- bulk crop management UI
- new matching thresholds or model changes
- any change to Feature 031 precedence rules

## Server Orchestration Details

### 1. Shared helpers

Add server-side helpers under `src/lib/matching/` for:

- preparing a review session
- reconciling a session on read
- applying a session item action
- signing face crop URLs
- deriving face review statuses from canonical current state

These helpers must reuse:

- `getManualPhotoLinkState(...)`
- `manualLinkPhotoToConsent(...)`
- `manualUnlinkPhotoFromConsent(...)`
- `ensureAssetFaceMaterialization(...)`
- existing tenant/project/consent validation helpers

Business logic stays server-side.

### 2. Pending materialization strategy in bulk mode

Bulk prepare must not direct-materialize every selected asset synchronously.

Chosen rule:

- single-asset manual review keeps its existing direct materialization behavior
- bulk prepare only requeues missing materializations and records pending items
- session read reconciles them when background materialization completes

This avoids turning one bulk click into a long synchronous request.

### 3. Concurrent user conflicts

Session reads and item actions must always re-read current canonical face ownership.

If another user changes a face while a session is open:

- the next item read or action reflects the new current assignee
- `link_face` may return `manual_conflict`
- the item remains actionable with `forceReplace` if that is allowed by Feature 031

## Security And Reliability

### 1. Tenant and auth rules

Every new route must:

- require authenticated user
- derive `tenantId` server-side
- validate the consent belongs to `tenantId + projectId`
- validate every asset belongs to `tenantId + projectId`
- never accept `tenant_id` from the client

### 2. Revoked consent

Revoked consent must block:

- session prepare
- session read advancement into new writes
- session item actions
- single-asset manual review actions

Read behavior when revocation happens mid-session:

- session remains readable
- pending or review items surface `blocked: consent_revoked`
- no new canonical writes occur

### 3. Partial failures

Prepare and reconcile should be item-granular:

- one failed item does not fail the whole session unless the consent itself is invalid/revoked
- blocked items stay in the session as blocked, not as hidden failures
- safe user-facing messages are derived from known error codes

### 4. Signed URL handling

- signed face crop URLs and preview URLs are short-lived
- session rows do not persist them
- reads regenerate them
- client should refetch session/manual-link-state if an image URL expires

### 5. Error shaping

- do not expose raw provider/materializer exceptions
- keep route errors in the existing `{ error, message }` shape
- add session-specific safe error codes rather than raw internals

## Edge Cases

### 1. Zero selected assets

- `POST review-sessions` returns `400 invalid_asset_ids`

### 2. Mixed zero/one/multi-face batch

- zero-face items complete as `linked_fallback`
- one-face items complete as `linked_face`
- multi-face items queue as `ready_for_face_selection`

### 3. Assets still processing

- prepare/reconcile requeue materialization if missing or stale
- items remain `pending_materialization` until current materialization exists

### 4. Assets rematerialized mid-session

- read path detects materialization id changes
- item face data is refreshed
- stale selected face is cleared
- item response sets `wasRematerialized: true`

### 5. Faces already assigned to another consent

- item read shows occupied state and current assignee
- item action returns `manual_conflict` when applicable

### 6. Manual conflict during session progression

- keep the item in queue
- return conflict metadata and `canForceReplace`
- let the operator retry with `forceReplace`

### 7. Session reopened after refresh

- `GET review-sessions/current` returns the open session for that user+consent
- client resumes from `nextReviewItemId`

### 8. Stale signed crop URLs

- no persisted signed URLs
- client refreshes the session read model when needed

### 9. Batch prepare succeeds partially

- session still returns `200`
- per-item blocked or pending states capture the partial outcome
- only consent-wide invalid conditions fail the entire request

### 10. Duplicate clicks and retries

- duplicate prepare reuses the open session when the selection hash matches
- duplicate per-item actions are safe through existing manual write semantics and session item re-read/update flow

## Implementation Phases

### Phase 1: Schema foundations

1. Add session tables and indexes.
2. Add face derivative table and indexes.
3. Add geometry metadata columns to materialization tables.
4. Add RLS and membership policies for new tables.
5. Add migration coverage for constraints and cleanup assumptions.

### Phase 2: Materialization geometry and crop support

1. Update face materialization writes to persist source image dimensions.
2. Map provider boxes into oriented original-image normalized coordinates.
3. Generate `review_square_256` face crops during materialization.
4. Add crop signing helper for face derivatives.
5. Keep crop generation non-fatal to canonical materialization.

### Phase 3: Review session server orchestration

1. Add session prepare helper.
2. Add session reconcile/read helper.
3. Add session item action helper.
4. Reuse existing `photo-face-linking.ts` manual write logic.
5. Add pending-materialization requeue behavior for bulk prepare.

### Phase 4: Route handlers and read models

1. Add review session routes.
2. Extend `manual-link-state` response with crop/status/normalized-box fields.
3. Extend linked asset read payloads with linked face crop URLs where available.
4. Keep response shapes explicit and conflict-safe.

### Phase 5: UI updates

1. Add multi-select and bulk review trigger to the consent asset matching panel.
2. Add resume-current-session behavior.
3. Extend the review dialog for queue mode, crop chips, progress, and blocked/pending states.
4. Render overlays from normalized coordinates against the measured displayed image area.
5. Add minimal keyboard/mobile ergonomics only where they are straightforward.

### Phase 6: Regression coverage and polish

1. Add session prepare/reuse tests.
2. Add pending-materialization reconciliation tests.
3. Add rematerialization mid-session tests.
4. Add manual conflict and force-replace tests in session mode.
5. Add crop signing/read tests.
6. Add overlay coordinate correctness tests.
7. Add refresh/resume tests.

## Test Plan

### Schema and migration tests

- migration applies cleanly from reset
- new constraints and uniqueness rules behave as expected
- new RLS policies keep tenant isolation intact

### Server orchestration tests

- prepare creates a session and classifies mixed zero/one/multi-face assets correctly
- duplicate prepare reuses the same session when the selection hash matches
- new prepare replaces the current open session for the same user+consent when the selection differs
- prepare blocks revoked consent
- reconcile advances `pending_materialization` items to completed or ready-for-face-selection
- reconcile handles rematerialized assets by updating prepared materialization state
- item actions reuse Feature 031 write semantics and surface `manual_conflict` cleanly
- duplicate item actions remain safe

### Crop and read-model tests

- face crop derivative row is created for each face when crop generation succeeds
- crop signing returns short-lived URLs for authorized reads
- missing crop derivative degrades safely without breaking review state
- linked assets response includes linked face crop URL when available

### Overlay correctness tests

- normalized face box values are persisted from materialization
- UI overlay placement uses normalized coordinates and measured displayed image bounds
- overlay placement remains correct for resized responsive previews and `object-fit: contain`

### UI integration tests

- multi-select + bulk review prepare shows correct summary counts
- one-face assets complete without extra manual face selection
- multi-face assets enter sequential review queue
- direct suppress-from-face-picker creates face-level suppression via existing unlink logic
- refresh resumes the active session
- blocked and pending states render correctly

### Edge-case tests

- zero selected assets returns `400`
- mixed batch partial success returns `200` with item-level states
- consent revoked mid-session blocks further actions
- stale `assetFaceId` after rematerialization is handled cleanly
- concurrent user manual assignment produces item-level conflict
- expired session returns `review_session_expired`
- stale signed crop URL recovers after session re-read

## Scope Boundaries

Feature 032 explicitly does not include:

- any change to Feature 031 canonical precedence semantics
- same-consent-on-multiple-faces-in-one-asset support
- matcher threshold or provider changes beyond box/crop metadata needed for UI correctness
- bulk DAM/export workflow changes
- unrelated queue or matching pipeline redesign

## Concise Implementation Prompt

Implement Feature 032 by adding a durable per-user-per-consent review session model, inline face-crop derivatives, normalized face-box rendering metadata, and bounded panel/dialog updates that reuse `photo-face-linking.ts` as the canonical write path. Keep Feature 031 semantics unchanged, keep bulk prepare asynchronous for missing materializations, make session reads resumable and idempotent, and add regression coverage for mixed batches, rematerialization, conflicts, crop reads, overlay correctness, and refresh/resume behavior.
