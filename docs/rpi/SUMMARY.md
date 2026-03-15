# SnapConsent Lite Summary

This document is a compact context summary of the project, based on `CONTEXT.md`, `ARCHITECTURE.md`, `AGENTS.md`, `README.md`, and the feature docs under `docs/rpi/`.

## What the app is

SnapConsent Lite is a multi-tenant web app for managing photo and media consent. A photographer or organization creates projects, sends public invite links to subjects, collects signed consent against a versioned template, emails a receipt, and supports later revocation without deleting historical records.

The product also manages project photos and can link those photos to consent records. Linking can be done manually and, in later features, with server-side facial matching based on an opted-in headshot.

This repository is also intentionally structured as a realistic practice app for AI-assisted development: small reviewable changes, explicit documentation, database-backed invariants, and server-first security.

## Core product model

- `tenants` and `memberships` define multi-tenant ownership and access.
- `projects` are the working containers for invites, subjects, consents, and assets.
- `consent_templates` are global versioned templates; invites point to a specific template version.
- `subject_invites` are public token-backed links used to collect consent.
- `subjects`, `consents`, `revoke_tokens`, and `consent_events` capture the auditable consent lifecycle.
- `assets` store uploaded project photos and headshots in private Supabase Storage.
- `asset_consent_links` is the canonical table for approved asset-to-consent links.
- Matching features add queue, suppression, candidate, and observability tables around that canonical link model.

## Key invariants

- Consent records are not deleted; revocation only stops future processing.
- All tenant-scoped data must be filtered by tenant on every query.
- `tenant_id` is never trusted from the client; it is derived server-side from auth/session/membership.
- Security-critical logic lives on the server, not in the browser.
- Writes should be idempotent and retry-safe.
- Supabase service role credentials stay server-only.

## Tech stack

- Next.js App Router + TypeScript
- Tailwind CSS
- Supabase Auth + Postgres + Row Level Security
- Supabase Storage for private media files
- Local development with Supabase CLI + Docker
- Migrations in `supabase/migrations`

## Architecture approach

- App UI lives in `src/app` and `src/components`.
- Server-side logic lives in Route Handlers and server utilities under `src/lib`.
- Authentication uses Supabase SSR patterns with middleware-based session refresh.
- Tenant isolation is enforced in both application code and Postgres RLS.
- Public invite and revoke flows are token-based and server-mediated.
- Matching work runs through internal token-protected worker/reconcile endpoints, not public routes.

## Development workflow

Non-trivial work follows RPI: Research -> Plan -> Implement.

- Research documents current behavior, schema, constraints, and risks.
- Plan documents the concrete change steps, migrations, security concerns, edge cases, and verification.
- Implementation is expected to follow the plan closely and stay PR-sized.

Key commands:

- Install: `npm install`
- Dev: `npm run dev`
- Lint: `npm run lint`
- Tests: `npm test`
- Reset local database: `supabase db reset`

## Implemented features

### Core platform

- `001-auth`: Supabase SSR auth with login, logout, protected routes, and middleware session refresh.
- `002-projects-invites`: Tenant/project foundation, project creation, single-use invite links, public consent submission, receipt email delivery, and idempotent revocation.
- `003-consent-templates`: Global versioned consent templates, template selection during invite creation, and immutable consent text/version snapshots stored on signed consents.
- `004-project-assets`: Private project asset uploads through signed URLs, asset metadata tables, many-to-many asset/consent linking, and project asset UI.
- `005-duplicate-upload-handling`: Duplicate detection using content hashes plus batch policies for `upload_anyway`, `overwrite`, or `ignore`.
- `006-headshot-consent`: Explicit biometric opt-in, required headshot when opting into facial matching, public headshot upload/finalize flow, staff headshot replacement, and headshot retention metadata/cleanup.
- `007-origin-url-consistency`: Relative internal redirects, browser-built share links, and `APP_ORIGIN` as the canonical server-side origin for email/external URLs.
- `008-asset-thumbnails`: Signed private thumbnail URLs for uploaded project photos and linked headshots in consent details.

### Matching system

- `009-matching-foundation`: Consent-centric manual matching workflow for linking and unlinking project photos to consents, with matching APIs and UI.
- `010-auto-face-matching`: Internal matching backbone with queue jobs, worker/reconcile flows, job dedupe/retry handling, and auto-link provenance metadata on canonical links.
- `011-real-face-matcher`: Real server-side matcher integration via CompreFace, threshold-based auto-linking, and persisted exact-pair suppression after manual unlink.
- `012-manual-review-likely-matches`: Review-band candidate persistence for medium-confidence matches plus UI/API support to review likely matches separately from confirmed links.
- `013-match-results-observability`: Optional internal persistence of scored match results for observability, debugging, and threshold analysis without changing canonical linking behavior.
- `015-headshot-replace-resets-suppressions`: Replacing a consent headshot clears that consent's prior manual-unlink suppressions so matching can reevaluate project photos with the new headshot.

### UI and UX

- `014-ui-navigation-refresh`: Shared protected app chrome, clearer dashboard/projects navigation, stronger project-detail sectioning, and improved public-page consistency without changing backend behavior.

## Current matching behavior in plain terms

- Facial matching is opt-in and depends on a valid linked headshot.
- Project photos and headshots stay private in Supabase Storage.
- Manual links remain authoritative.
- Manual unlink creates an exact-pair suppression so auto-matching does not immediately recreate the same link.
- Auto-matching runs asynchronously in internal worker jobs, not during normal page requests.
- Medium-confidence pairs can be surfaced for review, while high-confidence pairs can be auto-linked.


## Short mental model

Think of the app as:

1. A secure multi-tenant consent system.
2. A project-based photo workflow with private uploads and audit-friendly consent history.
3. A server-first matching pipeline that starts with manual review and layers automated matching on top without making the browser a trust boundary.
