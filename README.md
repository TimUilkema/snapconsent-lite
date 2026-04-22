# SnapConsent Lite

Minimal Next.js + Supabase app for consent workflows.

## Setup

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local` and fill values.
3. Start Supabase local stack.
4. Run app:
   `npm run dev`

## URL Origin Configuration

- Internal app redirects use relative paths and stay on the current host.
- Share links in the UI are built from the browser host (`window.location.origin`) plus invite path.
- External links in emails use `APP_ORIGIN`.

Set `APP_ORIGIN` in `.env.local`:

- Desktop-local only: `APP_ORIGIN=http://localhost:3000`
- LAN/mobile testing: `APP_ORIGIN=http://192.168.2.9:3000`
- Production: `APP_ORIGIN=https://app.snapconsent.com`

Note: Links created while browsing `http://localhost:3000` are not phone-shareable. For cross-device testing, open the app on desktop with the LAN host/IP.

## Mobile Uploads In Local Dev

Signed storage upload URLs can be generated with loopback hosts (for example `127.0.0.1`).  
The app normalizes loopback signed upload URLs to the current browser host for LAN/mobile testing.

Recommended local setup for phone testing:
- Open app via LAN host, not `localhost`.
- Set `APP_ORIGIN` to the same LAN host.
- If needed, set `NEXT_PUBLIC_SUPABASE_URL` to a LAN-reachable Supabase API host/port.

## Core Auth Flow

- Login: `/login`
- Protected dashboard: `/dashboard`
- Projects area: `/projects`

## Projects + Invites Flow (002)

1. Create a project at `/projects`.
2. Open project dashboard and create an invite URL.
3. Share invite URL (QR-safe).
4. Subject opens invite URL, submits consent form.
5. Receipt email is sent to subject with revoke link.
6. Subject can revoke consent from public revoke URL.

## Local Email Verification

The local Supabase config uses Inbucket for email testing.

- Inbucket UI: `http://127.0.0.1:54324`
- SMTP target for app mailer: `127.0.0.1:54325`

After submitting consent, verify in Inbucket:
- receipt delivered to subject email
- consent summary content
- revoke link works and marks consent revoked without deleting consent records

## Validation Commands

- Reset DB and apply migrations: `supabase db reset`
- Lint: `npm run lint`
- Run app: `npm run dev`

## Internal Matching Jobs

Backbone-only auto-matching queue and worker endpoints are internal and token-protected.

- Worker endpoint: `POST /api/internal/matching/worker`
- Reconcile endpoint: `POST /api/internal/matching/reconcile`
- Required env vars:
  - `MATCHING_WORKER_TOKEN`
  - `MATCHING_RECONCILE_TOKEN`

Example scheduler calls:

```bash
curl -X POST "$APP_ORIGIN/api/internal/matching/worker" \
  -H "Authorization: Bearer $MATCHING_WORKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"batchSize":10}'

curl -X POST "$APP_ORIGIN/api/internal/matching/reconcile" \
  -H "Authorization: Bearer $MATCHING_RECONCILE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lookbackMinutes":180,"batchSize":150}'
```

## Internal Asset Derivative Jobs

Project photo display derivatives are rendered asynchronously behind internal, token-protected endpoints.

- Worker endpoint: `POST /api/internal/assets/worker`
- Repair endpoint: `POST /api/internal/assets/repair`
- Required env vars:
  - `ASSET_DERIVATIVE_WORKER_TOKEN`
  - `ASSET_DERIVATIVE_REPAIR_TOKEN`

Example scheduler calls:

```bash
curl -X POST "$APP_ORIGIN/api/internal/assets/worker" \
  -H "Authorization: Bearer $ASSET_DERIVATIVE_WORKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"batchSize":10}'

curl -X POST "$APP_ORIGIN/api/internal/assets/repair" \
  -H "Authorization: Bearer $ASSET_DERIVATIVE_REPAIR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit":250}'
```

## Real Face Matcher (Feature 011)

Feature 011 adds a real matcher provider behind the existing matching worker architecture.

- Provider selector:
  - `AUTO_MATCH_PROVIDER=compreface`
- Required matcher env vars:
  - `AUTO_MATCH_CONFIDENCE_THRESHOLD`
  - `AUTO_MATCH_REVIEW_MIN_CONFIDENCE`
  - `AUTO_MATCH_PROVIDER_TIMEOUT_MS`
  - `COMPREFACE_BASE_URL`
  - `COMPREFACE_API_KEY`
- Optional:
  - `AUTO_MATCH_PIPELINE_MODE`
  - `AUTO_MATCH_WORKER_CONCURRENCY`
  - `AUTO_MATCH_PROVIDER_CONCURRENCY`
  - `AUTO_MATCH_MAX_COMPARISONS_PER_JOB`
  - `AUTO_MATCH_PERSIST_RESULTS`
  - `AUTO_MATCH_PERSIST_FACE_EVIDENCE` (requires `AUTO_MATCH_PERSIST_RESULTS=true`)
  - `AUTO_MATCH_RESULTS_MAX_PER_JOB`

### Local CompreFace setup (Docker)

1. Start the official CompreFace Docker stack.
2. Create a recognition/verification API key in CompreFace.
3. Set in `.env.local`:
   - `AUTO_MATCH_PROVIDER=compreface`
   - `COMPREFACE_BASE_URL=<your compreface host>`
   - `COMPREFACE_API_KEY=<your api key>`
4. Continue invoking the existing internal matching worker/reconcile endpoints.

Notes:
- No new public endpoints are introduced.
- Matching stays server-side in the internal worker.
- Keep CompreFace API keys server-only.
- Total CompreFace fan-out is roughly `AUTO_MATCH_WORKER_CONCURRENCY * AUTO_MATCH_PROVIDER_CONCURRENCY`, so tune both conservatively.

### Pipeline rollout modes

- `AUTO_MATCH_PIPELINE_MODE=raw` keeps the original raw pairwise verification flow.
- `AUTO_MATCH_PIPELINE_MODE=materialized_shadow` materializes faces and stores versioned embedding-compare outcomes, but does not change canonical link or candidate writes.
- `AUTO_MATCH_PIPELINE_MODE=materialized_apply` uses the materialized compare pipeline to drive the existing pair-level apply logic.
- Materialized apply still keeps `asset_consent_links` pair-level and canonical. Persisted winning face data is for later conflict-resolution features and does not enable face exclusivity by itself.

## Likely-Match Review Band (Feature 012)

- `AUTO_MATCH_REVIEW_MIN_CONFIDENCE` sets the lower bound for review candidates.
- Pairs in this band (`review_min <= confidence < auto_threshold`) are persisted for manual review.
- The consent matching panel can load these via `Review likely matches`.
- Candidates are only available after queued jobs are processed by the internal matching worker.

## Match Results Observability (Feature 013)

- `AUTO_MATCH_PERSIST_RESULTS=true` stores scored pair outcomes for worker jobs.
- `AUTO_MATCH_RESULTS_MAX_PER_JOB` optionally caps persisted rows per processed job.
- This is observability-only and does not change canonical matching behavior.

## Matched Face Evidence (Feature 017)

- `AUTO_MATCH_PERSIST_FACE_EVIDENCE=true` stores per-face geometry/embedding evidence for consent-linked match results.
- Requires `AUTO_MATCH_PERSIST_RESULTS=true` because face evidence is owned by persisted pair-level result rows.
- Face evidence is internal-only and does not change canonical link or review-candidate behavior.

## CompreFace Benchmarking

Use the local benchmark script to compare matcher throughput at different provider concurrency settings:

```bash
npx tsx scripts/benchmark-compreface-matcher.ts \
  --tenant-id <tenant-uuid> \
  --project-id <project-uuid> \
  --consent-id <consent-uuid> \
  --limit 180 \
  --runs 3 \
  --concurrency 1,2,4,8
```

This prints per-run and summary timing plus pairs/sec so you can tune `AUTO_MATCH_PROVIDER_CONCURRENCY`.
For worker throughput tuning, benchmark a small matrix of worker concurrency x provider concurrency values instead of raising both at once.
