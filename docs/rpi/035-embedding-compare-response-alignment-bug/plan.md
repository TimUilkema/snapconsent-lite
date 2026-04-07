# Feature 035 Plan: Embedding Compare Response Alignment Bug

## Scope

This plan fixes the verified bug where embedding-compare scores can be attached to the wrong target face in multi-face photos.

Scope includes:

- correct provider response alignment
- defensive handling for malformed embedding-verify responses
- regression coverage
- repair strategy for already-corrupted compare-derived state

Scope does not include:

- changing the canonical schema
- changing the materialization schema
- introducing new ambiguity-threshold product policy in the same patch unless the implementation proves it is necessary

## Desired outcome

After this change:

1. embedding-verify results are aligned to the correct requested target face
2. `winning_asset_face_id` and `winning_asset_face_rank` are correct
3. auto links, likely-match candidates, and review suggestions use the correct winning face
4. repair/replay no longer recreate the Kim -> Tim face swap
5. existing bad compare-derived state can be recomputed from current materializations without rematerializing everything

## Recommended implementation approach

### Step 1: Fix the provider adapter at the boundary

Modify `src/lib/matching/providers/compreface.ts` so that `compareEmbeddingsWithCompreFace(...)`:

- parses both `similarity` and returned `embedding`
- maps each response row back to one requested target embedding
- rebuilds the final `targetSimilarities` array in the original request order

Implementation detail:

- build a deterministic lookup key for requested target embeddings
- suggested first version: canonical JSON string of the numeric array
- map each response row by its returned `embedding` key
- place the similarity into the correct request slot

Why this shape:

- it keeps the fix local to the provider adapter
- it preserves the existing `AutoMatcherEmbeddingCompareResult` contract
- the rest of the materialized pipeline can stay unchanged

### Step 2: Add defensive alignment validation

If alignment is ambiguous or incomplete, do not silently guess.

Explicitly handle:

- missing `embedding` in a response row
- duplicate response rows for the same target embedding
- response row embedding that does not match any requested target
- fewer mappable rows than requested targets

Recommended behavior:

- log a bounded provider alignment warning with safe metadata only
- treat unmappable targets as `0`
- if the whole response is unusable, fail the compare request rather than attach a winner to the wrong face

Preferred default:

- fail closed rather than misassign

## Alternative implementation decision

There are two viable implementation shapes:

### Shape A: Reorder to the existing flat array

- keep `targetSimilarities: number[]`
- fix ordering inside the provider adapter

Pros:

- smallest change

Cons:

- keeps the interface less explicit

### Shape B: Make the matcher interface explicit

- extend `AutoMatcherEmbeddingCompareResult`
- return explicit target identity with the score

Pros:

- stronger type-level guarantee

Cons:

- wider refactor

Recommended choice for the first patch:

- Shape A

Reason:

- smallest PR-sized corrective change
- directly addresses the bug
- lower risk while current data is already corrupted

## Step-by-step plan

### Step 1: Add regression tests before changing behavior

Add or update tests in:

- `tests/feature-011-compreface-preprocess.test.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`

Required regression coverage:

1. provider unit test:
   - request target embeddings in one order
   - mock embedding-verify response rows in a different order
   - assert returned `targetSimilarities` come back in request order

2. provider malformed-response test:
   - missing or duplicate response embeddings
   - assert the provider does not silently mis-map scores

3. pipeline integration test:
   - multi-face photo
   - mocked compare response where best score belongs to face 1 but arrives first in ranked order
   - assert `winning_asset_face_rank = 1`
   - assert canonical face link uses that face

### Step 2: Fix `compareEmbeddingsWithCompreFace(...)`

Modify:

- `src/lib/matching/providers/compreface.ts`

Implementation steps:

1. replace `parseEmbeddingCompareSimilarities(...)` with a mapper that preserves target identity
2. build request-order lookup from `input.targetEmbeddings`
3. parse each response row into:
   - `similarity`
   - normalized returned `embedding`
4. map response rows back to request positions
5. return similarities in original target order

Hardening:

- keep all values clamped to `[0, 1]`
- do not expose raw embeddings in logs

### Step 3: Keep `materialized-face-compare.ts` unchanged unless needed

Because the provider adapter will restore correct request order, the current picker in:

- `src/lib/matching/materialized-face-compare.ts`

can likely remain unchanged.

Only change it if:

- testing shows the provider adapter cannot guarantee a reliable flat ordered array

### Step 4: Add explicit observability for alignment failures

Add bounded logging in the provider adapter for cases like:

- duplicate returned embedding
- unknown returned embedding
- missing returned embedding

Keep logs limited to:

- target count
- mapped count
- unmatched count
- provider/mode

Do not log raw embeddings.

### Step 5: Force compare recomputation for existing bad rows

Because materializations are still valid, the cleanest repair is:

- bump the compare version constant

This should force:

- fresh `asset_consent_face_compares`
- fresh candidate generation
- fresh canonical auto state from corrected compare winners

Why compare-version bump is preferred:

- the bug is in compare alignment, not detection/materialization
- rematerializing every photo is unnecessary

Likely file:

- `src/lib/matching/auto-match-config.ts`

### Step 6: Repair current projects

After the compare-version bump:

- run project repair / worker replay so current photos and headshots regenerate compare rows and canonical state

This should rebuild:

- `asset_consent_face_compares`
- `asset_consent_match_candidates`
- `asset_face_consent_links`

from existing materializations using corrected winner mapping.

### Step 7: Validate against the Kim/Tim project data

Use the same affected assets as the acceptance check:

- `IMG-20260117-WA0064.jpg`
- `IMG-20260117-WA0057.jpg`
- `20260112_100605.jpg`
- `20260112_100606.jpg`

Expected result after repair:

- Kim compare winners move to the actual Kim face in the group photo
- Tim compare winners stay on Tim's face
- auto/current links match the corrected winner face ids

## Files likely to change

Primary code:

- `src/lib/matching/providers/compreface.ts`
- `src/lib/matching/auto-match-config.ts`

Tests:

- `tests/feature-011-compreface-preprocess.test.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`

Docs:

- `docs/rpi/035-embedding-compare-response-alignment-bug/research.md`
- `docs/rpi/035-embedding-compare-response-alignment-bug/plan.md`

Likely unchanged:

- `src/lib/matching/materialized-face-compare.ts`
- schema migrations

Unless implementation reveals that the matcher contract must become explicit.

## Data and repair considerations

### No migration expected

This should not require a database migration if the fix stays within:

- provider response parsing
- compare version bump

### Existing corrupted state

Already-stored rows may be wrong in:

- `asset_consent_face_compares`
- `asset_consent_match_candidates`
- `asset_face_consent_links`

These rows should not be trusted until recomputed.

### Safe recomputation model

Use:

- current materializations
- new compare version
- repair/reconcile replay

Avoid:

- ad hoc SQL patching of individual face ids

Reason:

- the correct mapping should be deterministically recomputed by the fixed code

## Edge cases to handle

### Duplicate target embeddings

If two requested target embeddings are exactly identical:

- naive key-by-embedding becomes ambiguous

Expected practical risk:

- low, but not impossible

Recommended behavior:

- detect ambiguity
- fail closed for that compare or fall back to a deterministic slower path only for that case

The exact fallback can be decided during implementation.

### Provider returns rounded embeddings

If returned embeddings are numerically close but not byte-identical:

- exact string matching may fail

Recommended first implementation:

- try exact canonical JSON matching first

If that proves unstable in testing:

- introduce a tolerance-based vector matcher only inside the provider adapter

### Partial mapping

If only some rows can be matched back:

- do not allow the unmatched high score to drift onto the wrong face
- mapped rows may be used
- unmapped rows should become `0` or trigger a compare failure, depending on severity

### Old compare rows still marked current

`isStoredCompareCurrent(...)` uses timestamps, not semantic correctness.

So a compare-version bump is important. Without it:

- old bad rows can still be reused as current

## Testing and verification

Required verification:

1. `npm test -- tests/feature-011-compreface-preprocess.test.ts`
2. `npm test -- tests/feature-019-face-materialization-pipeline.test.ts`
3. any affected feature-031 or feature-032 tests if compare-derived suggestions change
4. `npm run lint`

Recommended manual verification after repair:

1. run compare repair / worker on the affected project
2. open the affected Kim/Tim group photos
3. confirm Kim's suggested/current face matches the actual Kim face
4. confirm the wrong face no longer shows the old high confidence winner

## Rollout recommendation

Recommended rollout order:

1. merge parser fix plus regression tests
2. bump compare version in the same change
3. run repair on local and any existing environments with affected data
4. only after correctness is restored, evaluate ambiguity-margin follow-up work if still needed

## Follow-up work after the corrective patch

These are good follow-ups, but should not block the bug fix:

1. make the embedding-compare matcher interface explicit instead of positional
2. add ambiguity-margin rules for multi-face auto-linking
3. add operator-facing diagnostics for why one face won over another
4. add a one-off admin/debug tool for re-running compares on a specific consent/photo set

## Success criteria

The fix is successful when all of the following are true:

1. out-of-order provider rows no longer produce face-rank drift
2. Kim/Tim-style group photos assign the score to the correct detected face
3. no new compare rows show the old "always face 0" pattern
4. repair/replay rebuilds correct canonical face links from current materializations
5. `1.0000` values, when they appear, are attached to the correct face and understood as rounded storage values rather than evidence of parser corruption
