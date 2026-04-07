# Feature 035 Research: Embedding Compare Response Alignment Bug

## Goal

Research the verified bug where materialized embedding compares can attach a valid similarity score to the wrong detected face in a photo, causing wrong face-level matches such as:

- `Kim Loenen` getting linked to `Tim Uilkema`'s face in group photos
- implausible `1.0000` face wins on the wrong face rank

This research is code-first and uses the current repository plus direct provider reproduction as ground truth.

## Inputs reviewed

Required docs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`

Relevant prior RPI docs:

- `docs/rpi/019-face-materialization-deduped-embedding-pipeline/*`
- `docs/rpi/031-one-consent-per-face-precedence-rules/*`
- `docs/rpi/032-face-consent-linking-ui-improvements/*`

Primary code inspected:

- `src/lib/matching/providers/compreface.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/photo-face-linking.ts`
- `tests/feature-011-compreface-preprocess.test.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`
- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`

Local evidence used:

- direct DB inspection of `asset_consent_face_compares`, `asset_face_materialization_faces`, and current links
- direct calls to CompreFace `POST /api/v1/verification/embeddings/verify` using stored embeddings from the local project data

Repository code and current provider behavior are treated as authoritative.

## Verified problem

### Current compare contract in our code

The materialized compare pipeline currently works like this:

1. `ensureMaterializedFaceCompare(...)` loads:
   - one current headshot face embedding
   - all detected photo face embeddings
2. it calls `matcher.compareEmbeddings(...)`
3. it receives `targetSimilarities: number[]`
4. it assumes `targetSimilarities[i]` belongs to `targetFaces[i]`
5. it picks the max by index position

That behavior is in:

- `src/lib/matching/materialized-face-compare.ts`

The CompreFace provider currently creates `targetSimilarities` like this:

- read `response.result`
- keep only `row.similarity`
- discard `row.embedding`
- return the similarities as a flat array

That behavior is in:

- `src/lib/matching/providers/compreface.ts`

### What CompreFace is actually returning

For `POST /api/v1/verification/embeddings/verify`, CompreFace returns rows that include:

- `similarity`
- `embedding`

In direct reproduction against the local data, the response rows were not reliably in the same order as the request `targets[]`.

Instead, the response behaved like a ranked list. The returned `embedding` field was the only reliable way to know which requested target face each score belonged to.

### Why this causes the Kim -> Tim failure

When the code drops the returned `embedding` and zips only by index, a high similarity can be attached to the wrong detected face row.

That means:

- the numeric score can be real
- the selected face can still be wrong

This exactly matches the observed user symptom:

- the compare score looked strong
- the chosen face in the group photo was the wrong person

## Direct reproduced evidence

The issue was reproduced directly against the local stored embeddings for these photos:

- `20260112_100605.jpg`
- `20260112_100606.jpg`
- `IMG-20260117-WA0057.jpg`
- `IMG-20260117-WA0064.jpg`

### Example: `IMG-20260117-WA0064.jpg`

Requested target order:

- face 0 -> `67ae...`
- face 1 -> `6b8c...`

Direct CompreFace embedding-verify response for Kim's headshot:

- `0.99676` belonged to face 1
- `0.21924` belonged to face 0

Current stored compare/link state:

- Kim stored as winner on face 0 with `0.9968`

So the score was attached to the wrong face.

### Example: `IMG-20260117-WA0057.jpg`

Requested target order:

- face 0 -> `80c9...`
- face 1 -> `667b...`

Direct CompreFace embedding-verify response for Kim's headshot:

- `0.99725` belonged to face 1
- `0.13649` belonged to face 0

Current stored compare/link state:

- Kim stored as winner on face 0 with `0.9973`

Again, the score was attached to the wrong face.

### Why some rows show `1.0000`

This is mostly a storage rounding artifact, not proof of a truly perfect match.

`winning_similarity` is stored as:

- `numeric(5,4)`

So a raw provider score like `0.99996` is stored as:

- `1.0000`

That explains the implausible-looking perfect matches.

## Root cause summary

The root cause is:

- our provider adapter assumes embedding-verify response order equals request target order
- CompreFace does not reliably preserve that order
- our code discards the response field that would let us realign rows correctly

This is not primarily:

- a consent-id mix-up
- a headshot-id mix-up
- a face-rank misunderstanding

It is a response-alignment bug in the materialized compare pipeline.

## Where this bug causes problems

### 1. Wrong compare winners

`asset_consent_face_compares` can persist:

- wrong `winning_asset_face_id`
- wrong `winning_asset_face_rank`
- correct-looking `winning_similarity` attached to the wrong face

This is the first corrupted durable state.

### 2. Wrong current auto links

The auto apply path uses the compare winner to create face-level canonical links.

That means the bug can create wrong rows in:

- `asset_face_consent_links`

So the wrong person can be auto-linked in the canonical photo-face state.

### 3. Wrong likely-match candidates

Review-band candidate rows can also inherit the wrong winning face id/rank.

That affects:

- `asset_consent_match_candidates`

So review may open with the wrong suggested face even when the raw similarity is genuinely high for a different face.

### 4. Wrong review/preselection UX

Feature 032 reuses the stored compare winner for:

- face review entry
- preselected face
- current candidate summaries

So the UI can look "confidently wrong" because it is faithfully rendering corrupted compare state.

### 5. Wrong face-level precedence resolution

Feature 031 resolves one-consent-per-face semantics using face ids.

If the compare winner is wrong, then:

- per-face auto conflict resolution happens on the wrong face
- manual-vs-auto replacement may appear inconsistent with the visual image
- repair/reconcile can deterministically recreate the wrong state

This is important: Feature 031 is not the source of the bug, but it amplifies the effect because face identity now matters more.

### 6. Repair and replay can preserve the bad outcome

Current repair and reconciliation paths trust durable compare rows or recompute using the same buggy alignment logic.

So the system can:

- reproduce the same wrong assignment after repair
- look stable and deterministic while still being wrong

### 7. Observability and operator trust degrade

Because the score can be high while the face is wrong, operators lose trust in:

- confidence percentages
- likely-match ordering
- the review queue's suggested selection

This is larger than a simple display bug.

## Fix options

### Option A: Realign provider response rows by returned embedding

Approach:

- keep using `POST /api/v1/verification/embeddings/verify`
- parse both `similarity` and returned `embedding`
- map each response row back to the requested target embedding
- reorder the final similarities into request-target order before returning from the provider adapter

Pros:

- smallest behavior change
- preserves Feature 019 performance benefits
- no schema change required
- no API change required
- keeps current `AutoMatcherEmbeddingCompareResult` contract if the reordering happens inside the provider adapter

Cons:

- depends on reliable embedding identity matching between request and response
- needs explicit handling for duplicates, missing rows, and malformed responses

Assessment:

- best primary fix

### Option B: Change the matcher contract to return explicit target identity

Approach:

- expand `AutoMatcherEmbeddingCompareResult`
- return a list like `{ targetIndex, similarity }[]` or `{ targetEmbedding, similarity }[]`
- make `materialized-face-compare.ts` use explicit identity instead of a flat array

Pros:

- makes the invariant explicit in the domain interface
- reduces the chance of future provider adapters making the same mistake

Cons:

- wider code churn than Option A
- more interface updates and test changes

Assessment:

- good hardening option
- likely best as a follow-up or folded into the same change if kept small

### Option C: Compare each target face in a separate provider request

Approach:

- call embedding verify once per face instead of once per face set

Pros:

- trivial mapping
- no response-order ambiguity

Cons:

- destroys the main performance win of Feature 019
- increases provider calls and queue cost sharply on group photos
- regresses scalability for bounded fan-out

Assessment:

- not recommended

### Option D: Fall back to raw image verify for all multi-face photos

Approach:

- keep embeddings for single-face
- use raw image verify when target face count > 1

Pros:

- may avoid this exact API behavior

Cons:

- reintroduces repeated detection/embedding work
- weakens the materialized pipeline
- still does not guarantee better multi-face identity handling

Assessment:

- not recommended as the main fix

## How to prevent Kim -> Tim mismatches in group photos

### Must-fix baseline

The first and most important prevention step is:

- fix the response alignment bug

Without that, no confidence threshold or UI tweak can make the system trustworthy.

### After the parser fix, useful hardening options

#### 1. Treat unmatched or duplicate embedding rows as compare failure

If the provider response cannot be mapped back to the requested targets safely:

- do not guess
- do not persist a winner
- log a provider protocol/alignment error
- surface no-match or retryable failure instead of a wrong face

This prevents silent corruption.

#### 2. Recompute current compares after the fix

Existing bad compare rows and auto-links must be rebuilt.

Without this, old corrupted winners remain in place even after the parser is fixed.

#### 3. Add ambiguity gating for multi-face photos

Even with correct face alignment, some group photos may still be ambiguous.

A bounded protection is:

- if the top and second-best candidates for a face or a consent are too close, send to review instead of auto-linking

Pros:

- reduces confident false positives in crowded photos

Cons:

- needs careful product tuning
- is a behavior change, not just a bug fix

Assessment:

- good follow-up hardening
- not required for the first corrective patch

#### 4. Add stronger per-face explainability in review

This does not prevent wrong matches directly, but it helps operators catch them:

- show which face actually won
- show confidence on the actual winner
- ensure suggested face comes from corrected compare data

This is partly already in place after Feature 032 and will improve automatically once compare winners are correct.

## Recommended direction

Recommended fix sequence:

1. Fix the provider response alignment in the embedding compare adapter.
2. Add regression tests proving out-of-order provider results map back to the correct face.
3. Add a defensive failure path for malformed/unmappable embedding-verify responses.
4. Bump compare version and rebuild compare-derived state from current materializations.
5. Only after correctness is restored, consider ambiguity-margin rules as a separate quality improvement.

## Key conclusion

The main issue is not that CompreFace thinks Kim and Tim are the same person.

The verified issue is:

- CompreFace returns ranked embedding-verify rows
- our code treats them as positional
- the wrong face wins even when the underlying score belongs to another face

That is why Kim can be linked to Tim's face in group photos while still showing a strong or even rounded-to-perfect confidence.
