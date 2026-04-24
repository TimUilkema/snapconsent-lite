# CONTEXT.md

## Project
SnapConsent

The application manages **digital consent for photos or media usage**.

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

The system will likely contain:

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
- **CompreFace**
- **Supabase**
    - Postgres
    - Auth
    - Row Level Security

Supabase migrations are stored in `/supabase/migrations`.

Local development uses **Supabase CLI + Docker**.

---

## Development Philosophy

Changes should be:
- small
- reviewable
- well-reasoned
- research → plan → implement workflows
- safe incremental development
