# 017 Face Result Geometry and Embeddings - Research

## Goal

Validate the smallest production-safe design to persist and later export per-face bounding boxes and face embeddings for matched consent subjects in project assets, for DAM/Elasticsearch use, without breaking existing SnapConsent matching invariants.

This research is code-verified against repository ground truth. Existing docs are intent; implementation is authoritative.

## Verification scope

Read and verified:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/010-auto-face-matching/*`
- `docs/rpi/011-real-face-matcher/*`
- `docs/rpi/012-manual-review-likely-matches/*`
- `src/lib/matching/*`
- `src/lib/matching/providers/compreface.ts`
- matching trigger routes and internal worker/reconcile routes
- matching-related tests (`feature-010`, `feature-011`, `feature-011-compreface-preprocess`, `feature-012`, `feature-013`)
- matching-related migrations for:
  - `asset_consent_links`
  - `asset_consent_link_suppressions`
  - `asset_consent_match_candidates`
  - `asset_consent_match_results`
  - queue tables/functions and relevant RLS

External provider docs checked:

- CompreFace REST API doc (`docs/Rest-API-description.md`)
- CompreFace services/plugins doc (`docs/Face-services-and-plugins.md`)

## Current implementation summary (code-true)

### Matching architecture

- Queue/worker/reconcile architecture is implemented and active.
- Queue table: `face_match_jobs` with constrained `job_type`, `status`, dedupe, and retry/dead behavior via SECURITY DEFINER RPC helpers.
- Trigger points enqueue jobs from:
  - photo finalize (`photo_uploaded`)
  - consent submit (`consent_headshot_ready` when non-duplicate + opt-in + headshot)
  - headshot replacement (`consent_headshot_ready`)
- Worker revalidates eligibility at execution time.

### Canonical link semantics

- Canonical approved link table is `asset_consent_links`.
- Rows include both headshot links and photo-consent links.
- Auto/manual provenance uses `link_source` (`manual`/`auto`), not `match_type`.
- Manual links are authoritative:
  - DB trigger prevents downgrading `manual` to `auto`.
  - worker skips manual pairs.
- Manual unlink suppression is persisted in `asset_consent_link_suppressions` and worker respects it.

### Candidate and result persistence

- Review-band table `asset_consent_match_candidates` is implemented and used.
- Observability table `asset_consent_match_results` is implemented and conditionally used only when `persistResults` is enabled (`AUTO_MATCH_PERSIST_RESULTS`, default `false`).
- No application read-path currently uses `asset_consent_match_results` (only worker writes + tests read it).

### Worker write behavior (current)

- Scored pair `confidence >= auto_threshold`:
  - upsert canonical auto link (`asset_consent_links`)
- Scored pair `review_min <= confidence < auto_threshold`:
  - upsert review candidate (`asset_consent_match_candidates`)
- Scored pair `confidence < review_min`:
  - delete existing candidate row for exact pair
- Suppressed/manual pairs:
  - skip auto/candidate writes
  - delete stale candidate rows for those exact pairs
- Stale auto links:
  - remove exact pair where score drops below auto threshold
  - remove exact pair if pair is suppressed

## Verified semantics of existing match tables

## 1) `asset_consent_links`

Meaning in current code:

- Canonical active approved link state between asset and consent.
- Used for:
  - manual linking/unlinking
  - auto-link writes
  - headshot linking
- Contains provenance and auto metadata (`link_source`, `match_confidence`, `matched_at`, `matcher_version`, review fields).

Implications:

- This is not a score history table.
- This is not a per-face geometry/embedding table.
- One row per `(asset_id, consent_id)` cannot represent multiple detected faces in target image.

## 2) `asset_consent_match_candidates`

Meaning in current code:

- Latest-state review-band candidate store per exact `(asset_id, consent_id)`.
- Used for likely-review mode in matchable assets API.
- Worker lifecycle enforces band semantics and stale cleanup for scored pairs.

Implications:

- It is intentionally non-canonical (suggestions, not approved links).
- It is not job-historical.
- It currently stores only scalar confidence + metadata, no geometry/embeddings.

## 3) `asset_consent_match_results`

Meaning in current code:

- Optional per-job scored-pair observability table.
- Upsert key: `(job_id, asset_id, consent_id)`.
- Stores confidence, decision class, matcher version, thresholds, scored timestamp.
- Internal-only table (RLS enabled, no anon/authenticated access, service role granted).

Implications:

- It is closest current fit for detailed scoring telemetry.
- Today it stores pair-level outcome only, not per-face payload.
- By default it is likely empty in normal environments (`AUTO_MATCH_PERSIST_RESULTS=false`).

## Research questions (explicit answers)

## Q1. Current meaning of `asset_consent_links`, `asset_consent_match_candidates`, `asset_consent_match_results`?

Answered above: canonical link state, review-band latest candidate state, optional job-level observability state respectively.

## Q2. Is it true that auto links are only above threshold and candidates are below-threshold review matches?

Mostly true with precise current wording:

- There is no `match_type`; code uses `link_source`.
- Worker only writes `link_source='auto'` when `confidence >= auto_threshold` and pair is not manual/suppressed.
- Worker writes candidates only for `review_min <= confidence < auto_threshold` and not manual/suppressed.
- Stale auto links are deleted when score falls below threshold or pair is suppressed.

Caveat:

- Legacy/manual seeded rows can exist outside worker rules.

## Q3. What does current CompreFace provider integration return today in SnapConsent?

Current SnapConsent provider contract (`AutoMatcherMatch`) returns only:

- `assetId`
- `consentId`
- `confidence` (similarity normalized to `[0,1]`)

Current adapter behavior:

- Calls `POST /api/v1/verification/verify`
- Sends only `source_image` and `target_image` (base64)
- Parses only `result[0].face_matches[0].similarity`
- Discards all other provider fields

So in current app output there is:

- similarity: yes
- source/target boxes: not surfaced
- embeddings: not surfaced
- provider face IDs / multi-face structures: not surfaced

Also current code does not request/report provider model/plugin metadata (`plugins_versions`).

Empirical runtime validation from local headshot-replace + worker run (user-provided logs):

- CompreFace `status: 200`
- `parsedSimilarity` values observed (`1`, `0.95351`)
- raw provider payload (logged as `providerMessage`) includes nested geometry under:
  - `result[0].source_image_face.box`
  - fields such as `x_min`, `y_min`, `x_max`, `y_max`, `probability`

Interpretation:

- Current SnapConsent integration confirms wire-level response includes face box geometry data.
- Current implementation still only parses/persists similarity and drops the face geometry payload.
- This evidence strengthens the recommendation to extend provider parsing and persist per-face geometry in a dedicated evidence table.

## Q4. If embeddings are not currently returned, what CompreFace settings/plugins/endpoints are required?

From CompreFace docs:

- Embeddings are tied to the calculator plugin.
- For API responses, `face_plugins` can include `calculator` to include embedding fields in face objects.
- CompreFace docs also provide embedding-specific endpoints (recognition/verification "using embedding vectors"), including verification embedding endpoints.
- Services/plugins doc indicates calculator plugin is enabled by default and has slug `calculator`.

Practical implication for SnapConsent:

- Current provider request omits plugin/status controls and ignores embedding fields.
- To persist embeddings/boxes, SnapConsent must explicitly parse extended response fields (and/or adopt embedding endpoints), and persist plugin/model metadata returned by provider.

## Q5. In current verify-based flow, what is the correct unit of persisted result?

Current persisted unit is per `(asset_id, consent_id)` pair (and per `job_id` for observability).

For DAM geometry/embedding need, this is insufficient because a single target asset can contain multiple faces. The correct exportable unit is per detected face match in the target asset, linked back to the pair/job context.

## Q6. Best table fit for boxes + embeddings?

Assessment:

- Extend `asset_consent_links`: not fit (canonical state table, not per-face, not job-scored evidence).
- Extend `asset_consent_match_candidates`: not fit (review-band only; excludes above-threshold canonical outcomes).
- Extend `asset_consent_match_results` only: partial fit, but current uniqueness is per pair/job; cannot represent multiple faces cleanly without schema change.
- Add new per-face table: best fit and least disruptive to canonical semantics.

Recommended fit:

- Keep `asset_consent_match_results` as pair/job parent observability row.
- Add child per-face table keyed by parent result (or by job+pair+face index) for geometry/embedding payloads.

## Q7. Smallest design satisfying DAM need while preserving invariants?

Smallest production-realistic design:

1. Keep canonical behavior unchanged:
   - `asset_consent_links` remains canonical approved state
   - manual authority/suppression unchanged
2. Keep worker/queue architecture unchanged.
3. Extend matcher/provider output to include optional per-face detail.
4. Add one new table for per-face evidence tied to job/pair result rows.
5. Persist this only in worker path (same retry/idempotency discipline).
6. Add export path later reading from this evidence with tenant scoping and consent-state filters.

## Q8. What data should be persisted per scored face result?

Recommended minimal per-face record:

- scope:
  - `tenant_id`
  - `project_id`
  - `job_id`
  - `asset_id`
  - `consent_id`
  - `match_result_id` (FK to `asset_consent_match_results`) or equivalent key
- face identity within provider response:
  - `face_rank` (deterministic ordering, e.g. similarity desc)
  - optional provider face reference fields if present
- score:
  - `similarity` (normalized float)
- geometry:
  - `source_face_box` (headshot face box)
  - `target_face_box` (asset face box)
- embedding:
  - `source_embedding`
  - `target_embedding` (if returned)
  - store as array/json payload if SnapConsent is not performing vector search itself
- provider/model metadata:
  - `provider` (e.g. `compreface`)
  - `provider_mode` (`verification`)
  - `matcher_version` (SnapConsent adapter version)
  - `provider_plugin_versions` (detector/calculator versions when available)
  - embedding dimensionality and similarity metric assumptions
- timing:
  - `scored_at`
  - `created_at`

## Q9. Implications (retries, duplicates, headshot replacement, revocation, stale, partial failures)?

### Idempotent retries / duplicate delivery

- Use deterministic upsert key:
  - `(job_id, asset_id, consent_id, face_rank)` for per-face rows
- Replayed job updates same rows, no duplicates.

### Headshot replacement

- New job writes new result rows with new `job_id` and updated headshot context.
- Preserve history; do not mutate old rows.
- Include headshot asset identity in payload lineage so export can choose newest applicable evidence.

### Revoked biometric consent

- Worker already skips future matching for revoked consents.
- Historical evidence remains unless explicit purge policy is added.
- DAM export for operational indexing should filter revoked consents (or export with explicit revoked flag).

### Stale results

- Current system intentionally keeps observability history.
- DAM-facing export should define "current" selection strategy (for example latest succeeded job per pair with canonical link present).

### Partial failures

- Worker writes are multi-step and not wrapped in one DB transaction.
- Current safety model is convergence via idempotent retry on job failure.
- New per-face writes should follow same upsert pattern so retries converge.

## Q10. Must DAM use same embedding model/library?

Depends on usage:

- If DAM stores SnapConsent vectors only as opaque payload for metadata retrieval/display:
  - strict model parity is not required for storage itself.
- If DAM compares vectors in one shared vector index (SnapConsent vectors + DAM-generated vectors or query vectors):
  - same embedding model family/version and preprocessing pipeline must be aligned, otherwise similarity scores are not comparable.

Therefore SnapConsent should persist model metadata (provider + detector/calculator versions + matcher version + vector dimensionality + normalization assumptions) with each face result to make downstream usage safe.

## CompreFace capability vs current integration

Current code path:

- `verification/verify` request with minimal payload.
- Only top similarity scalar is consumed.

CompreFace capability from docs:

- verification responses can include structured face-level data (source face and matched faces) with boxes and optional embeddings when plugin-enabled.
- plugin/version metadata can be included in responses (`plugins_versions`).
- embedding-oriented verification endpoints exist.

Gap:

- SnapConsent currently does not persist any provider face geometry or vector payload, and does not capture provider plugin/model version metadata.

## Storage option analysis

## Option A - Extend `asset_consent_links`

Pros:

- no new table

Cons:

- breaks canonical-purpose boundary
- one row per pair cannot cleanly represent multi-face details
- stores heavy biometric payload in canonical link state

Verdict: reject.

## Option B - Extend `asset_consent_match_candidates`

Pros:

- existing table

Cons:

- only review-band scope
- excludes above-threshold auto-link outcomes that DAM likely needs most

Verdict: reject.

## Option C - Extend `asset_consent_match_results` only

Pros:

- right lifecycle context (job-scored observability)

Cons:

- current uniqueness is one row per pair/job
- awkward for multiple matched faces unless embedding/boxes are array blobs in one row

Verdict: partial; workable but less clean.

## Option D - Add per-face result table (recommended)

Pros:

- preserves canonical/link semantics
- naturally models multi-face target assets
- supports idempotent retry keys
- clean export source for DAM

Cons:

- adds one table and worker write path

Verdict: best smallest safe fit.

## Recommended bounded design for feature planning

### Keep unchanged

- queue/worker/reconcile architecture
- canonical `asset_consent_links` semantics
- manual authority and suppression logic
- tenant scoping and opt-in gating

### Add

1. Provider detail output type in matcher interface:
   - preserve current `confidence` contract
   - add optional per-face details collection for advanced providers
2. Per-face evidence table:
   - linked to `asset_consent_match_results`
   - one row per face match in provider response
3. Worker persistence extension:
   - when results persistence is enabled, write parent pair result row(s) then child face row(s)
   - idempotent upsert keys
4. Metadata capture:
   - provider plugin/model version fields
   - embedding dimensionality/schema metadata

### Do not add in this phase

- new public matching endpoints
- canonical link redesign
- cross-project/global identity redesign

## Code/docs mismatches found

1. Terminology mismatch with request assumptions:
   - code uses `link_source`; there is no `match_type` column.
2. `asset_consent_match_results` is implemented but effectively opt-in:
   - default env disables persistence, so table can be empty in normal operation.
3. `reconcile_project` job type exists in schema/worker handling, but reconcile flow currently enqueues photo/consent scoped jobs directly.

## Final conclusion

Smallest production-safe path is:

- keep `asset_consent_links` as canonical state,
- keep existing worker/queue flow,
- add per-face evidence persistence anchored to job/pair results,
- upgrade CompreFace adapter parsing to capture face-level geometry/embedding and provider version metadata,
- export DAM payload from this per-face evidence layer with explicit consent/recency filters.

DAM model/library requirement:

- Not mandatory for raw storage of vectors,
- Mandatory for meaningful cross-system vector similarity/search in one index.

Persisting provider/model/version metadata is required either way for operational safety.
