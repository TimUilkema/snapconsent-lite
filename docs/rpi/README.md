# RPI Workflow

This repository uses a **Research → Plan → Implement (RPI)** workflow for all non-trivial changes.

The goal is to keep changes **well reasoned, incremental, and reviewable**, especially when using AI agents such as Codex.

Each feature or task should have its own folder.

Example:

docs/rpi/001-auth/
docs/rpi/002-consent-template-crud/

---

# Workflow

## 1. Research

Goal: Understand the current system before writing code.

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