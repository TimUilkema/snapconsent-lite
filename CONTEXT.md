# CONTEXT.md

## Project
SnapConsent Lite

This project is a simplified version of the SnapConsent concept.  
The goal of this repository is primarily to experiment with **AI-assisted software development workflows using Codex**, while building a small but realistic web application.

The application manages **digital consent for photos or media usage**.

The full SnapConsent product would include advanced features (watermarking, biometric scope, DAM integrations, etc.), but this repository focuses only on a minimal core domain.

---

## Core Domain Concept

People (subjects) can give consent for media usage.

Consent is granted based on a **consent template** which defines:
- what usage is allowed
- who the controller is
- optional scopes

Consent records are **auditable and immutable**.

Revocation is possible but **does not delete historical records**.

---

## Simplified Domain Entities

The simplified system will likely contain:

- **tenants**  
  Organizations using the platform.

- **users**  
  Authenticated users belonging to a tenant.

- **consent_templates**  
  Defines what consent is being requested.

- **consents**  
  Records that a subject granted consent.

- **subjects**  
  The person giving consent.

This repository intentionally keeps the data model simple at first.

---

## Key Domain Invariants

These rules should never be violated:

- Consent records are **never deleted**.
- Revoking consent only stops **future processing**.
- All domain data is **tenant scoped**.
- Every action must be **auditable**.

---

## Technology Stack

The project standard stack:

- **Next.js (App Router)**
- **TypeScript**
- **TailwindCSS**
- **Supabase**
    - Postgres
    - Auth
    - Row Level Security

Supabase migrations are stored in `/supabase/migrations`.

Local development uses **Supabase CLI + Docker**.

---

## Development Philosophy

The main goal of this repository is to practice:

- AI-assisted coding
- repository-aware agents
- research → plan → implement workflows
- safe incremental development

Changes should be:
- small
- reviewable
- well-reasoned
