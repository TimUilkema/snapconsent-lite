# 011 Real Face Matcher - Research

## Goal
Implement a real face matcher behind the existing Feature 010 queue/worker/reconcile backbone, with no architecture redesign.

## Source of truth
This research is based on the current repository state:
- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/010-auto-face-matching/research.md`
- `docs/rpi/010-auto-face-matching/plan.md`
- current implementation in `src/lib/matching/*`, trigger routes, internal worker/reconcile routes, and 010 migrations.

Note: the repository path is `docs/rpi/010-auto-face-matching/` (not `010-auto-face-matching-backbone/`).

Documentation describes intended behavior, but the repository code is the ground truth.

## 1) Current baseline (Feature 010 already in repo)

- Queue/backbone exists:
  - `public.face_match_jobs` with constrained `job_type`, `status`, and valid scope combinations.
  - SECURITY DEFINER helpers: enqueue/claim/complete/fail.
- Trigger moments are wired:
  - Photo finalize route enqueues `photo_uploaded`.
  - Public consent submit route enqueues `consent_headshot_ready` when non-duplicate + opted-in + headshot.
  - Headshot replacement route enqueues `consent_headshot_ready`.
  - Reconcile scans and backfills both sides.
- Worker exists and revalidates eligibility server-side at execution time (opt-in, not revoked, valid headshot/photo state).
- Canonical link table remains `asset_consent_links`.
- Manual provenance protection exists in DB trigger:
  - Existing `link_source='manual'` row cannot be downgraded to `auto`.
- `auto-matcher.ts` is currently a stub returning `[]`.

Conclusion: 011 should only replace matcher behavior and add threshold-driven auto-linking, while preserving the 010 backbone and invariants.

## 2) Research answers

### 2.1 Matcher decision for 011
Explicit decision for Feature 011:

- Use **CompreFace**
- Run it as a **local/self-hosted Docker service**
- Call it only from server-side worker code behind `auto-matcher.ts`

Why this is the right choice for 011:
- Fits the existing async worker architecture
- Keeps provider integration outside public request paths
- Avoids client exposure of secrets
- Works well for local development
- Does not require cloud setup or paid external APIs
- Provides similarity scores that can be normalized and used with a threshold

### 2.2 Local Docker service vs local library wrapper vs external API
Recommended for 011: **local Docker face-matching service**, specifically **CompreFace**.

Alternatives:
- Local Node library (`face-api.js`/`tfjs-node`):
  - rejected for 011 due native deps, runtime friction, and cross-platform instability
- External cloud API (AWS/Azure/etc.):
  - rejected for 011 because it adds account setup, cost, privacy/data-egress concerns, and weaker local testability

### 2.3 Best provider boundary behind `auto-matcher.ts`
Keep domain logic in worker; isolate provider integration in a provider adapter module.

Recommended boundary:
- `auto-match-worker.ts`
  - owns job claiming, eligibility checks, candidate set construction, threshold evaluation, and link write behavior
  - resolves storage references for photo/headshot assets
- `auto-matcher.ts`
  - provider-agnostic matcher interface
  - dispatches to configured provider adapter
- `src/lib/matching/providers/compreface.ts`
  - CompreFace-specific HTTP payload/response mapping
  - no domain policy decisions

This keeps architecture unchanged and separates matching integration from queue/domain logic.

### 2.4 Internal score shape
Standardize on normalized confidence in `[0, 1]`.

Use/keep:
- `AutoMatcherMatch = { assetId, consentId, confidence }`
- confidence must be finite and clamped/rejected outside `[0,1]`
- CompreFace scores are converted to normalized `[0,1]` before returning

### 2.5 Threshold model for first real version
Single global threshold env var for both job types.

Recommended:
- `AUTO_MATCH_CONFIDENCE_THRESHOLD` (default `0.92`, configurable)
- `confidence >= threshold` -> eligible for auto-link write
- `confidence < threshold` -> treated as non-match

Keep this intentionally simple for 011; no per-tenant/per-project tuning yet.

### 2.6 `photo_uploaded` matching behavior
For one finalized eligible photo:
- load all eligible consents in same tenant/project with valid current headshot
- compare this photo against each consent headshot
- emit `(asset_id=photo, consent_id)` matches with normalized confidence
- apply threshold + idempotent write rules

Important:
- one photo may match **multiple consents**
- this is already supported by the existing many-to-many canonical table shape
- 011 should support multi-person photos at the pair level without introducing face-region or review-queue complexity

### 2.7 `consent_headshot_ready` matching behavior
For one eligible consent headshot:
- load all eligible uploaded photos in same tenant/project
- compare consent headshot against each photo
- emit `(asset_id=photo, consent_id)` matches with normalized confidence
- apply threshold + idempotent write rules

Important:
- one consent may match multiple photos
- one photo may match multiple consents

### 2.8 Idempotent DB write strategy
Use retry-safe writes against the canonical table for exact pair `(asset_id, consent_id)`.

For above-threshold pairs:
- create or update canonical row
- write:
  - `link_source='auto'`
  - `match_confidence`
  - `matched_at`
  - `matcher_version`

Idempotency properties:
- duplicate jobs and worker retries remain safe
- reprocessing same pair updates deterministic auto metadata, not duplicate rows

### 2.9 Manual override and photographer authority
Photographer actions must override automatic behavior for exact pair `(asset_id, consent_id)`.

Required behavior:
- existing manual row for exact pair remains manual
- auto pipeline must not downgrade manual provenance
- if photographer manually links a pair, that manual decision is authoritative even if the matcher score is below threshold later
- if photographer manually unlinks a pair, future auto-processing should not recreate that exact pair automatically

This means 011 should preserve explicit human intent, not just provenance on existing rows.

### 2.10 Auto-link lifecycle behavior
Auto links should represent current matcher belief, while manual actions remain authoritative.

Recommended behavior:

- If `confidence >= threshold`:
  - eligible to create or update an auto link for exact pair
  - but not if exact pair is already manual or has been explicitly manually rejected
- If `confidence < threshold`:
  - create no new link
  - if an existing **auto** link for exact pair exists, it should be removed
  - existing **manual** links must never be removed by the matcher

Recommendation:
- for 011, remove stale auto links when a rerun drops below threshold
- rationale: false positives are more harmful than false negatives in this workflow, and stale auto links should not persist if the matcher no longer supports them

### 2.11 Failure and retry behavior
Use existing queue retry/dead transitions via `fail_face_match_job`.

Recommended classification:
- Retryable:
  - provider timeout
  - transient network failure
  - provider 5xx
- Non-retryable:
  - invalid provider config/auth
  - invalid image format payload rejected by provider
  - permanent request contract errors

Ineligible records are not failures and should complete without links:
- revoked consent
- opt-out
- missing/expired/archived headshot
- archived/non-uploaded photo
- below-threshold score

### 2.12 Minimal config for local dev/testability
Add minimal matcher envs:
- `AUTO_MATCH_PROVIDER=compreface`
- `AUTO_MATCH_CONFIDENCE_THRESHOLD=0.92`
- `AUTO_MATCH_PROVIDER_TIMEOUT_MS=8000`
- `COMPREFACE_BASE_URL=http://127.0.0.1:<port>`
- `COMPREFACE_API_KEY=<server-side secret>`

Optional but useful:
- `AUTO_MATCH_MAX_COMPARISONS_PER_JOB` for bounding runtime

### 2.13 Privacy/security implications
Key controls for this architecture:
- all matching remains server-side
- service secrets remain server-only
- strict tenant/project scoping in every query and write
- eligibility re-check at execution time prevents stale consent state use
- avoid logging biometrics or raw image bytes
- prefer local/self-hosted CompreFace for development to reduce biometric data egress
- respect headshot retention/archival; ineligible assets are excluded

## 3) Edge cases for 011

- Duplicate jobs:
  - dedupe key + idempotent writes prevent duplicate active links
- Revoked consent:
  - worker re-check skips/ignores for future matching
- Opt-out (`face_match_opt_in=false`):
  - never match
- Missing/expired/archived headshot:
  - consent side becomes ineligible
- Archived/non-uploaded photo:
  - photo side becomes ineligible
- Retry behavior:
  - transient provider failures requeue with backoff; exhausted attempts go `dead`
- Provider failure during batch:
  - failing job transitions correctly; does not corrupt canonical links
- Tenant scoping:
  - all queries constrained by `tenant_id` + `project_id`; no client tenant input
- Manual override:
  - existing manual row is never downgraded or removed by auto
- Manual unlink:
  - explicit manual unlink for exact pair must suppress future auto recreation of that same pair
- Auto-link downgrade:
  - if confidence falls below threshold later, remove only the exact existing auto link for that pair
- Multi-person photo:
  - supported in 011 via multiple `(asset_id, consent_id)` links for the same asset
- Cross-project matching:
  - out of scope and blocked by current scoping

## 4) Recommended 011 approach (bounded)

Implement 011 as a small extension to 010:

- keep queue/worker/reconcile architecture and trigger moments unchanged
- use **CompreFace** as the actual matcher provider for 011
- replace stub matcher with CompreFace-backed adapter in `auto-matcher.ts`
- normalize provider score to `[0,1]` and apply one global threshold
- reuse existing canonical `asset_consent_links` path for active links
- preserve manual authority over exact pairs:
  - manual link always overrides auto
  - manual unlink suppresses future automatic recreation for that pair
- support multiple consents per photo and multiple photos per consent
- remove stale auto links when confidence later drops below threshold
- add focused tests for:
  - threshold pass/fail writes
  - idempotent reprocessing
  - manual row preservation when auto target exists
  - manual unlink suppression behavior
  - auto-link removal on later below-threshold rerun
  - multi-person photo behavior
  - provider timeout/error retry classification

This is the smallest production-realistic step that makes auto-matching real without architecture drift.

## 5) Alternatives rejected for now

- Full embeddings platform/candidate table/review queue:
  - rejected as out of 011 scope and unnecessary for first real matcher behind current backbone
- New public matching endpoints:
  - rejected; internal worker/reconcile endpoints already exist and fit architecture/security
- Cross-project or global identity matching:
  - rejected; violates current tenant/project-scoped model and increases risk
- Leaving stale auto links untouched after later below-threshold reruns:
  - rejected because stale false positives are worse than missed matches in this workflow