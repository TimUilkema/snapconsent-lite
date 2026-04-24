# RPI Workflow

This repository uses a **Research → Plan → Implement (RPI)** workflow for all non-trivial changes.

The goal is to keep work **well reasoned, incremental, and reviewable** by separating:
- understanding the problem
- deciding the implementation approach
- executing the work

Each phase should have a clear outcome before moving to the next one.

Each feature or task gets its own folder:


Example:

docs/rpi/001-auth/
docs/rpi/002-consent-template-crud/

---

# Workflow

## 1. Research

Purpose: understand the problem and the current system before proposing changes.

Create:

docs/rpi/<feature-id>/research.md

Research should describe:

- Current relevant code structure
- Database schema involved
- Existing constraints (RLS, auth, tenant scope)
- External dependencies (Supabase, Next.js APIs, etc.)
- Potential risks or edge cases

No code changes should happen during research.

---

## 2. Plan

Goal: Define a clear implementation strategy.

Create:

docs/rpi/<feature-id>/plan.md

The plan should include:

- Step-by-step implementation plan
- Database migrations if required
- API changes
- UI changes
- Security considerations
- Edge cases (retries, auth failures, race conditions)
- How the change will be tested

Plans should be explicit enough that implementation can follow them directly.

---

## 3. Implement

Goal: Execute the plan with minimal deviation.

During implementation:

- Follow the plan closely
- Keep commits small and reviewable
- Update the plan if something changes

After implementation:

- Run lint/tests
- Confirm migrations work from a clean state (`supabase db reset`)
- Ensure tenant isolation and security rules remain intact

---
## Development data and migrations

During feature development, this repo assumes a fresh local database is acceptable.

- Prefer clean forward migrations over complex historical backfills when a feature changes schema shape.
- It is acceptable for local testing to use `supabase db reset` and start from fresh seed/dev data.
- Do not spend implementation time preserving arbitrary old local development rows unless the feature explicitly requires migration/backfill compatibility.
- Still write migrations so a fresh database reset applies cleanly from scratch.
- Still preserve production-safety where explicitly requested, but default RPI feature work may optimize for clean schema evolution and fresh local validation.

## Implementation notes and comments

During implementation, add concise code comments where they help preserve important product or security invariants.

Comments should explain non-obvious decisions discovered during Research or Plan, especially around tenant scoping, workspace boundaries, permission checks, retry/idempotency, public-token safety, consent history, and matching/review rules.

Do not over-comment obvious code. If the explanation is broad architectural context, keep it in the RPI documents instead of scattering it through code.


# Naming Convention

Each feature gets a numbered folder:

docs/rpi/
001-auth/
002-consent-template-crud/
003-subject-management/

The number keeps work organized chronologically.

---

# When to use RPI

Use the RPI workflow for:

- New features
- Database schema changes
- Authentication or security changes
- Multi-file refactors
- Anything that affects system behavior

Small UI tweaks or typo fixes do not require RPI.

---

# Benefits

The RPI workflow provides:

- better reasoning for AI agents
- safer incremental development
- easier code review
- better architectural discipline