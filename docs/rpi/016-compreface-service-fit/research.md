# 016 CompreFace Service Fit - Research

## Goal

Validate whether the current CompreFace service mode used by SnapConsent is the right fit for the real product matching pattern:

- one headshot per consent subject
- compare against many project assets
- many assets are group photos with multiple faces
- keep existing queue/worker/reconcile backbone

## Ground Truth (Repository Code)

### Current matching architecture

Verified in code:

- Backbone is queue-driven (`face_match_jobs`) with job types:
  - `photo_uploaded`
  - `consent_headshot_ready`
  - `reconcile_project`
- Worker is internal-only and token-protected:
  - `src/app/api/internal/matching/worker/route.ts`
- Reconcile is internal-only and token-protected:
  - `src/app/api/internal/matching/reconcile/route.ts`
- Enqueue trigger points are in place:
  - photo finalize route
  - consent submit route
  - consent headshot replacement route

### Current CompreFace integration behavior

Verified in `src/lib/matching/providers/compreface.ts`:

- Provider uses **verification endpoint** only:
  - `POST /api/v1/verification/verify`
- For each candidate pair, provider sends:
  - `source_image` = consent headshot
  - `target_image` = project photo
- Worker builds candidate pairs and calls matcher repeatedly (N calls):
  - `photo_uploaded`: one photo vs many consents/headshots
  - `consent_headshot_ready`: one consent headshot vs many photos
- Provider does in-memory preprocessing before upload (size/format), no persisted derivatives.
- Provider currently sends only image payload fields (no explicit tuning options like `det_prob_threshold` or `limit`).

### Current decision/write model

Verified in `src/lib/matching/auto-match-worker.ts`:

- Threshold model:
  - `confidence >= AUTO_MATCH_CONFIDENCE_THRESHOLD` => auto-link upsert
  - review band => candidate row upsert
  - below review min => no link/candidate
- Canonical links remain in `asset_consent_links`.
- Manual links remain authoritative.
- Suppressed pairs are skipped.
- Stale auto links are removed when score drops below threshold.

## CompreFace Service Roles (Official Docs)

From CompreFace docs/SDK docs:

- **Detection service**:
  - detects faces/landmarks/pose/emotion in an image
  - endpoint family: `/api/v1/detection/*`
- **Recognition service**:
  - identifies faces in an image against enrolled subjects in a recognition database
  - endpoint family: `/api/v1/recognition/*`
  - supports options such as `det_prob_threshold`, `prediction_count`
- **Verification service**:
  - compares one face from source image against face(s) in target image and returns similarity
  - endpoint family: `/api/v1/verification/*`
  - source image is expected to contain one face

References:

- https://github.com/exadel-inc/CompreFace/blob/master/docs/Face-services-and-plugins.md
- https://github.com/exadel-inc/compreface-python-sdk
- https://github.com/exadel-inc/CompreFace/blob/master/docs/Rest-API-description.md

## Fit Analysis For SnapConsent Use Case

### Is current verification mode valid?

Yes, functionally valid for pairwise scoring:

- It can be used as repeated 1:1 calls across many pairs.
- It keeps provider logic isolated behind `auto-matcher.ts`.
- It requires no external enrollment lifecycle.

### Is current verification mode optimal?

Not optimal for SnapConsent's group-photo-heavy flow:

- Worker sends full group photo as `target_image` on every pair.
- No explicit detection-stage control is applied today.
- Group images with small/occluded faces are more likely to return "no face"/very low confidence.
- The same asset is reprocessed per consent pair (costly and can degrade consistency at scale).

### Would recognition mode fit better?

Yes, recognition is a better conceptual fit for this product pattern:

- SnapConsent already has a stable "subject identity" concept (consent).
- Recognition is designed for "who is in this image?" against enrolled known subjects.
- One asset can return multiple detected faces and multiple subject predictions naturally.
- This maps directly to "one photo may match many consents".

Tradeoff:

- Requires provider-side enrollment lifecycle for consent headshots (create/update/delete subject faces).
- Adds provider-state synchronization complexity (still containable inside provider adapter).

## Group Photo Implications

With current verification-only mode:

- Group photo handling is implicit and depends on verification endpoint behavior on full target image.
- No code-level face detection pass/cropping exists before verify.
- No per-face candidates from a photo are surfaced directly by provider integration.

With recognition mode:

- Group photo is first-class: detect faces + predict subjects in one request flow.
- Better semantic alignment for "many consents can appear in one asset".

## Smallest Production-Realistic Next Step

Recommendation:

1. Keep CompreFace as provider.
2. Keep queue/worker/reconcile architecture unchanged.
3. Switch provider adapter logic from verification-only to a recognition-centered flow for project-photo evaluation.
4. Keep worker thresholding/canonical writes exactly as-is (server-side).

Bounded implementation shape (next feature cycle):

- Add provider mode switch in adapter/config (default safe).
- Maintain mapping between `(tenant_id, project_id, consent_id)` and CompreFace subject identifier.
- On `consent_headshot_ready`, ensure subject enrollment is updated for that consent headshot.
- On `photo_uploaded`, call recognition on the photo and convert recognition results to `(asset_id, consent_id, confidence)` matches.
- Continue enforcing suppression/manual-authority/idempotent write rules in worker (unchanged).

## Alternatives Considered

### A) Keep verification mode and only tune thresholds/options

Pros:

- smallest code delta
- no provider-state sync

Cons:

- still fundamentally pairwise on full target photo
- weaker group-photo semantics
- likely to keep current false-negative pain points

### B) Add explicit detection + per-face verification loop

Pros:

- improves group-photo handling without full recognition enrollment

Cons:

- essentially re-implements recognition pipeline complexity in app code
- more moving parts than using recognition service directly

### C) Replace CompreFace entirely now

Pros:

- could improve quality if moving to another provider

Cons:

- unnecessary architecture churn
- higher risk and migration effort
- not the smallest change

## Code/Docs Mismatches Observed

1. Feature 010 docs describe a provider-less backbone (historically true), but repository now includes real provider integration from Features 011+.
2. Feature 012 research text includes assumptions that no candidate persistence exists; repository now has `asset_consent_match_candidates` implemented.
3. Current behavior after Feature 015: headshot replacement clears consent suppressions before re-match; older docs that imply permanent suppression after manual unlink are no longer complete.

## Recommendation

CompreFace is still a good provider fit, but **verification-only mode is not the best service mode for SnapConsent's actual group-photo matching pattern**.  

Use CompreFace **recognition service mode** behind the existing provider boundary as the next bounded improvement, while keeping the queue/worker/reconcile architecture and canonical link semantics unchanged.

