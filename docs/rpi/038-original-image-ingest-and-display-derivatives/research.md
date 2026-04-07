# 038 Original Image Ingest + Display Derivatives - Research

## Goal
Research how SnapConsent should support broader image uploads across both project photo upload entry points while:

- preserving the original upload as faithfully as possible
- still rendering images reliably in the web app
- keeping tenant scoping and private storage intact
- avoiding format-specific UI breakage such as the current large Pixel JPEG failure

This research is for the RPI research phase only. No application code changes are proposed in this document.

## Sources inspected

### Required project docs
- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`

### Relevant current code
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
- `src/components/projects/assets-upload-form.tsx`
- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/lib/matching/providers/compreface.ts`

### Prior RPI docs checked for intent
- `docs/rpi/004-project-assets/research.md`
- `docs/rpi/008-asset-thumbnails/research.md`
- `docs/rpi/024-upload-performance-resumability/research.md`

### External references
- Supabase Storage image transformations:
  - https://supabase.com/docs/guides/storage/serving/image-transformations
- MDN `accept` attribute:
  - https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/accept
- MDN image format guide:
  - https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types
- web.dev image format guidance:
  - https://web.dev/articles/choose-the-right-image-format
- Android Ultra HDR image format:
  - https://developer.android.com/media/platform/hdr-image-format

## Current implementation analysis

### 1. There are two photo upload entry points, but both are constrained separately in the client
Project assets upload:
- `src/components/projects/assets-upload-form.tsx`
- client allowlist: `image/jpeg`, `image/png`, `image/webp`

Consent matching panel upload:
- `src/components/projects/consent-asset-matching-panel.tsx`
- client allowlist: `image/jpeg`, `image/png`, `image/webp`

Server-side create validation:
- `src/lib/assets/create-asset.ts`
- server allowlist: `image/jpeg`, `image/png`, `image/webp`

So both upload buttons currently reject the same formats, but they do so in duplicated code paths. The backend is the real gate, not the `accept` attribute.

### 2. The system stores originals as uploaded, but it does not generate durable display-safe derivatives
Current asset ingestion:
- `createAssetWithIdempotency()` creates an `assets` row and signed upload URL
- the browser uploads the original object directly to private Supabase Storage
- `finalizeAsset()` only marks the asset uploaded and optionally creates consent links

Current asset display:
- project asset list, matchable photos, linked photos, and review responses all call `signThumbnailUrlsForAssets()`
- `signThumbnailUrlsForAssets()` calls `createSignedUrl(..., { transform })`
- thumbnails and previews are therefore generated on demand from the original stored object through Supabase Storage image transformations

There is no separate persisted preview/thumbnail object for project photos today.

### 3. Matching and UI rendering use different image-processing stacks
Display path:
- relies on Supabase Storage image transformation
- currently uses the original stored file as the transform source

Matching/materialization path:
- `src/lib/matching/providers/compreface.ts`
- uses `sharp` to decode, orient, resize, and re-encode images before sending them to CompreFace

This means the matching pipeline can successfully process some files that the UI preview pipeline cannot render.

### 4. The current bug is a product-architecture issue, not just a single bad file
The observed failing file uploads successfully and the original object is readable, but the transformed preview and thumbnail URLs fail. That means:

- original storage worked
- asset metadata and private bucket access worked
- browser preview component did not cause the failure
- the failure sits specifically in the "transform the original on demand for UI" path

Because most UI surfaces depend on that same transform helper, this is not isolated to one screen.

## Reproduced failure and root technical fault line

Observed on `PXL_20260130_094538924.jpg`:
- original object fetch succeeds
- transformed thumbnail URL fails
- transformed preview URL fails
- error returned by Supabase transform endpoint: `Invalid source image`
- local `sharp` decode and re-encode succeeds

The file is a JPEG from a Pixel device and contains Ultra HDR gain-map style metadata. The Android Ultra HDR spec describes a primary JPEG plus gain-map JPEG encapsulated through XMP container metadata.

Inference from the observed behavior plus the Android and Supabase docs:
- the uploaded object is still a valid JPEG
- browser/original download compatibility is better than Supabase transform compatibility for this file
- the current UI path is fragile because it assumes any valid original upload is also transform-safe in Supabase/imgproxy

This same class of failure can happen for any source format or metadata combination that:
- is storable as an original
- may even be browser-decodable or `sharp`-decodable
- but is not reliably transformable by Supabase Storage

## Where the problem can happen

Any product surface that signs transformed URLs from original assets can break for the same reason. Current blast radius includes:

- project asset grid API: `src/app/api/projects/[projectId]/assets/route.ts`
- project asset enlarged preview: fed by the same asset API preview URL
- consent matchable photo list: `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
- consent linked photo list: `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- face review session responses: `src/lib/matching/face-review-response.ts`
- project page headshot previews where signed transformed URLs are used

Face crops can still appear because they are derivative artifacts created during face materialization and do not depend on transforming the original asset object at display time.

## External constraints and format support findings

### 1. Browser file-input `accept` is only a hint
MDN explicitly notes that `accept` guides the file picker but does not validate the file type. Server-side validation is still required.

Implication:
- broadening the client `accept` value alone does not solve anything
- the server must own the canonical support policy

### 2. Web-safe display formats are narrower than "all image files"
MDN and web.dev show that:
- JPEG and PNG are universally supported in browsers
- WebP and AVIF are supported in modern browsers
- TIFF is not broadly web-safe and MDN calls out Safari as the native browser support case

Implication:
- if the product goal is "store original as faithfully as possible" plus "render in the web app", then the storage format and the display format should not be treated as the same thing

### 3. Supabase transform support is broader than our current allowlist, but still not enough to be the product boundary
Supabase documents transformed image support for:
- PNG
- JPEG
- WebP
- AVIF
- GIF
- ICO
- SVG
- BMP
- TIFF

Supabase also documents:
- HEIC is supported as a source image but not as a transformed result
- transform limits include `25MB` size and `50MP` resolution

Implications:
- broadening our allowlist to "anything Supabase can transform" is still insufficient
- even documented source support does not guarantee every real-world file variant will transform cleanly
- a future policy that wants HEIC support already requires a derivative strategy because HEIC cannot be the transformed output format

### 4. Ultra HDR JPEGs are real JPEGs with extra structure
Android's Ultra HDR spec shows JPEG-based packaging with XMP container metadata and gain-map items.

Implication:
- "valid JPEG" is not a strong enough assumption for "safe source for our current preview-transform path"
- even inside the current `image/jpeg` allowlist, transform compatibility can vary

## Product problem statement

The current architecture conflates three different concerns:

1. What originals we are willing to ingest and preserve
2. What our server-side tooling can decode/process
3. What the web app can reliably display

That works only while every original image is also directly usable as a transform source for the UI. The Pixel Ultra HDR JPEG failure demonstrates that this assumption is already false.

If we simply broaden uploads without changing this architecture, we will increase the number of stored assets that:
- upload successfully
- may even materialize faces successfully
- but fail to render in thumbnails/previews across the UI

## Options considered

### Option A. Keep storing originals and keep using Supabase transforms directly on those originals
Description:
- broaden the allowlist
- continue signing transformed URLs against the original file

Pros:
- minimal architectural change
- keeps current asset model

Cons:
- preserves the current failure mode
- still ties UI correctness to Supabase transform compatibility for every original
- will be especially weak for HEIC/HEIF, TIFF variants, Ultra HDR JPEGs, and other metadata-heavy files

Assessment:
- not sufficient

### Option B. Normalize or re-encode the original in place during upload/finalize
Description:
- replace the uploaded original with a standardized browser-safe version

Pros:
- simple display story
- downstream systems see one normalized file

Cons:
- breaks the DAM-style requirement to preserve the original "as original as possible"
- loses original metadata/format fidelity
- makes future export/audit less trustworthy

Assessment:
- not recommended

### Option C. Store the original untouched and generate normalized display derivatives
Description:
- preserve the original upload exactly
- generate app-safe derivatives for preview and thumbnail use
- UI reads derivatives first, not transforms of the original

Pros:
- aligns with DAM requirements
- decouples original preservation from web rendering constraints
- avoids recurring transform failures on original files
- lets us standardize dimensions, color space, EXIF orientation, and metadata handling for previews
- gives one shared rendering contract across all UI surfaces

Cons:
- adds derivative generation and storage complexity
- needs derivative failure handling
- may require schema/storage metadata expansion

Assessment:
- recommended direction

### Option D. Convert files in the browser before upload
Description:
- transform user images client-side into a web-safe format before upload

Pros:
- reduces server-side derivative work

Cons:
- contradicts the original-preservation requirement
- browser decoding support is inconsistent for non-web-safe formats
- large image conversion is expensive client-side
- weak for reliability and auditability

Assessment:
- not recommended as the main architecture

### Option E. Keep current architecture but add fallback to signed original URLs when transforms fail
Description:
- continue using transformed URLs where possible
- fall back to the signed original object if transform rendering fails

Pros:
- useful tactical mitigation
- likely fixes some current JPEG cases immediately

Cons:
- does not solve non-browser-safe originals
- does not unify rendering behavior
- still leaves every page dependent on transform success first

Assessment:
- useful fallback, but not a full product strategy

## Recommended direction

### Recommendation
Adopt a two-artifact model for uploaded images:

1. Preserve the original object exactly as uploaded
2. Generate normalized display derivatives for web use

The UI should stop depending on transforming the original asset object at display time.

### Recommended product policy
For project photo uploads and future DAM use:

- accept and store original image uploads according to a shared server-owned ingest policy
- generate at least:
  - a thumbnail derivative
  - a larger preview derivative
- keep those derivatives in a browser-safe format and dimensions that the app controls
- use the same ingestion and derivative rules for both:
  - project assets upload
  - consent matching "Upload new photos"

### Why this fits the repo's intent
This direction is consistent with earlier asset features:
- original assets already have durable storage paths and asset records
- the repo already accepts derivative artifacts for face crops/materializations
- private storage and tenant-scoped signing remain intact
- the matching pipeline already normalizes images before provider use

The missing piece is to do the same normalization for UI display instead of assuming the original object is always a safe transform source.

## Suggested support tiers for planning

### Tier 1: common still-image support target
This is the practical first target for "uploads should work and render in the app":

- JPEG
- PNG
- WebP
- AVIF
- GIF
- BMP
- TIFF
- HDR/gain-map JPEG variants such as Pixel Ultra HDR JPEGs

For these, the expected behavior should be:
- preserve original
- produce usable preview and thumbnail derivatives

### Tier 2: source-preserving, derivative-required formats
These should only be promised if the deployed server-side decoder stack can process them consistently:

- HEIC / HEIF
- other phone-camera formats that browsers do not display reliably

Reason:
- Supabase already documents HEIC as source-only, not transformed result
- these formats fit the original-plus-derivative model, but should not be promised unless the server runtime can actually decode them in production

### Tier 3: future/explicitly out-of-scope until separately planned
- RAW camera formats
- PSD
- proprietary vendor formats
- very large multi-page image/document hybrids

These are closer to full DAM/media-ingest scope and need separate planning for decode libraries, quotas, performance, and product semantics.

## Architectural implications for a future plan

The plan phase should likely consider:

- shared image ingest policy module used by both upload UIs and server validation
- derivative generation during finalize or an internal job immediately after finalize
- derivative metadata persisted in a tenant-scoped, retry-safe way
- preview UI reading derivative URLs instead of transformed original URLs
- fallback behavior when derivative generation is pending or fails
- whether headshots should use the same derivative pipeline
- whether original signed URLs remain available for download/open-original behavior

## Risks and edge cases to carry into planning

- partial failure: original upload succeeds but derivative generation fails
- idempotency: retries must not create duplicate derivative rows or orphaned objects
- large files near current size limits
- very high-resolution images that exceed transform or processing limits
- EXIF orientation
- ICC profiles and color space conversion
- HDR metadata and gain maps
- animated formats: whether to preserve animation in preview or derive a poster frame
- HEIC/HEIF availability differences across local/dev/prod runtimes
- browser fallback when a derivative is missing
- lifecycle cleanup when an asset is archived or replaced
- storage cost increase from derivative objects

## Research outcome

The current bug is not just "Supabase cannot handle one big JPEG". It exposes a larger design issue:

- originals are preserved
- matching can sometimes process them
- but UI rendering is still coupled to on-the-fly transformation of the original

That coupling will continue to fail as soon as the product accepts a wider range of real-world image files.

The recommended direction for the next RPI phase is:
- keep originals untouched
- generate normalized display derivatives
- unify both upload entry points behind one shared ingest policy
- treat "ingest/original support" separately from "browser display support"

That gives SnapConsent a path toward a DAM-style model without sacrificing reliable web rendering.
