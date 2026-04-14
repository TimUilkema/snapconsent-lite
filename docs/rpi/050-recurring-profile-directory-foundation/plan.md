# Feature 050 - Recurring Profile Directory Foundation - Plan

## Inputs and ground truth

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/049-recurring-profiles-and-consent-management-foundations/research.md`
- `docs/rpi/049-recurring-profiles-and-consent-management-foundations/plan.md`
- `docs/rpi/050-recurring-profile-directory-foundation/research.md`
- Live implementation verified for plan-critical boundaries:
  - [src/app/(protected)/profiles/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/profiles/page.tsx)
  - [src/components/profiles/profiles-shell.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/profiles/profiles-shell.tsx)
  - [src/lib/profiles/profile-access.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/profiles/profile-access.ts)
  - [src/components/navigation/protected-nav.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/navigation/protected-nav.tsx)
  - [src/app/(protected)/layout.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/layout.tsx)
  - [src/lib/tenant/resolve-tenant.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/tenant/resolve-tenant.ts)
  - [src/app/api/templates/route.ts](/C:/Users/tim/projects/snapconsent-lite/src/app/api/templates/route.ts)
  - [src/app/api/projects/route.ts](/C:/Users/tim/projects/snapconsent-lite/src/app/api/projects/route.ts)
  - [src/lib/templates/template-service.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/templates/template-service.ts)
  - [messages/en.json](/C:/Users/tim/projects/snapconsent-lite/messages/en.json)
  - [messages/nl.json](/C:/Users/tim/projects/snapconsent-lite/messages/nl.json)
  - [supabase/migrations/20260304212000_002_projects_invites_idempotency.sql](/C:/Users/tim/projects/snapconsent-lite/supabase/migrations/20260304212000_002_projects_invites_idempotency.sql)

Use the live repo code and schema as source of truth. Feature 049 and Feature 050 research set the product boundary, but do not override the code.

## Verified current planning boundary

- `/profiles` already exists as a protected server-rendered shell page under the primary protected nav.
- The current shell is intentionally placeholder-only and still centered on future baseline-consent concepts.
- Access is already server-resolved through `resolveProfilesAccess`; `owner` and `admin` are manage-capable, `photographer` is read-only.
- Tenant resolution already happens server-side through `resolveTenantId` and `ensureTenantId`.
- Protected mutations in the live app currently lean on route handlers plus service-layer helpers, not server actions.
- The repo already has an `idempotency_keys` table and reusable service-layer idempotency patterns.
- No recurring-profile tables, routes, or services exist yet.
- No `use server` action pattern is established for this area.

## Recommendation

Implement Feature 050 as the first real recurring-profile directory slice, not as a consent feature. Add two new tenant-scoped tables, reuse the existing protected `/profiles` route and access helper, convert the page from a consent placeholder into a real server-rendered directory, and add route-handler mutations for create and archive flows.

The smallest coherent slice is:

- real `recurring_profiles`
- real `recurring_profile_types`
- owner/admin create profile
- owner/admin archive profile
- owner/admin create profile type
- owner/admin archive profile type
- protected list, search, type filter, and include-archived filter
- photographer read-only access

Teams, notes, consent requests, reminders, import, sync, and profile detail pages stay deferred.

## Chosen architecture

### Route and page model

- Keep the protected route at `/profiles`.
- Keep the existing protected nav entry and access helper.
- Replace the current shell content with a real server-rendered directory page.
- The page reads data directly through a new server-side profiles service. Do not add a read API route just to feed the page.
- Use route handlers only for mutations. This matches current repo patterns better than introducing server actions here.

### Service-layer shape

Add a dedicated service module under `src/lib/profiles/` for directory operations, separate from project and consent domains. Recommended shape:

- `listRecurringProfilesPageData`
- `createRecurringProfile`
- `archiveRecurringProfile`
- `createRecurringProfileType`
- `archiveRecurringProfileType`

Keep `profile-access.ts` as the small role-resolution helper and reuse it from both the page and mutation routes.

### Mutation surface

Add route handlers for:

- `POST /api/profiles`
- `POST /api/profiles/[profileId]/archive`
- `POST /api/profile-types`
- `POST /api/profile-types/[profileTypeId]/archive`

Do not add placeholder routes for consent requests, reminders, import, or sync.

### Data-access pattern

- Resolve auth and tenant server-side in every route and server page.
- Never accept tenant id from the client.
- Reuse `HttpError` and `jsonError` for safe error shaping.
- Reuse the existing `idempotency_keys` table for create-profile and create-type requests.

## Exact scope boundary

### Real in Feature 050

- schema and RLS for recurring profiles and recurring profile types
- server-side list and summary queries
- protected `/profiles` directory page backed by real data
- search by name/email
- filter by profile type
- include-archived filter
- real create-profile flow
- real archive-profile flow
- real create-profile-type flow
- real archive-profile-type flow
- owner/admin management UI
- photographer read-only real directory UI

### Placeholder-only in Feature 050

- `Request baseline consent`
- `Send reminder`
- `Request extra consent`
- `Import profiles`
- `Sync directory`

These remain visible only in low-emphasis deferred sections. They must stay disabled and non-interactive.

### Removed or replaced from the Feature 049 shell

- Replace the baseline-consent summary cards with real directory metrics.
- Remove baseline-status filtering from the primary filter row.
- Replace baseline-specific table columns with directory columns.
- Remove baseline-consent placeholder actions from the main empty state and row-level actions.

## Exact schema/model plan

### `recurring_profile_types`

Add a dedicated small lookup table, not a generic taxonomy engine.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete cascade`
- `label text not null`
- `normalized_label text not null`
- `status text not null default 'active' check (status in ('active','archived'))`
- `created_by uuid not null references auth.users(id) on delete restrict`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `archived_at timestamptz null`

Constraints and indexes:

- unique index on `(id, tenant_id)` so profiles can use a composite tenant-safe foreign key
- partial unique index on `(tenant_id, normalized_label)` where `status = 'active'`
- index on `(tenant_id, status, label)`
- index on `(tenant_id, updated_at desc)`

Lifecycle decision:

- include create plus archive now
- do not add rename now
- do not add delete now
- archived types stay attached to existing profiles and remain visible in read paths
- archived types are excluded from new-profile selection by default

### `recurring_profiles`

Columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete cascade`
- `profile_type_id uuid null`
- `full_name text not null`
- `email text not null`
- `normalized_email text not null`
- `status text not null default 'active' check (status in ('active','archived'))`
- `created_by uuid not null references auth.users(id) on delete restrict`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `archived_at timestamptz null`

Foreign key:

- composite foreign key `(profile_type_id, tenant_id)` references `recurring_profile_types(id, tenant_id)` with `on delete restrict`

Constraints and indexes:

- partial unique index on `(tenant_id, normalized_email)` where `status = 'active'`
- index on `(tenant_id, status, updated_at desc)`
- index on `(tenant_id, profile_type_id, status, updated_at desc)`

Field decisions:

- `email` is required in v1
- `normalized_email` is server-derived from trimmed lower-case email
- only one active recurring profile per normalized email per tenant
- archived profiles do not block later reuse of the same normalized email
- `profile_type_id` stays optional in v1
- do not add team, notes, phone, or headshot fields in this slice

### Database enforcement

Use small database-side enforcement, not UI-only rules.

- Add RLS policies for tenant-scoped select on both tables for all tenant members.
- Add insert and update policies only for tenant `owner` and `admin`.
- Add no delete policies.
- Add a small `before insert or update` trigger for each table, or a shared function pair, to:
  - normalize label and email values
  - keep `updated_at` current
  - set `archived_at` when status becomes `archived`
  - keep `archived_at` null for active rows
  - prevent unsupported update paths for this slice

For Feature 050, treat both tables as create-plus-archive domains. Direct edits and unarchive are deferred.

## Permission model

- `owner`: view, create profile, archive profile, create type, archive type
- `admin`: view, create profile, archive profile, create type, archive type
- `photographer`: view only

This matches the existing `resolveProfilesAccess` boundary and should stay server-authoritative.

## Exact API/read/write plan

### Reads

Use direct server-side service calls from `/profiles`, not GET API routes.

`listRecurringProfilesPageData({ supabase, tenantId, userId, q, profileTypeId, includeArchived })`

Returns:

- `access`
- `summary`
- `profiles`
- `profileTypes`
- `filters`

Validation:

- `q`: trimmed string, max bounded length
- `profileTypeId`: optional uuid that must belong to the tenant if present
- `includeArchived`: boolean derived server-side from query params

### `POST /api/profiles`

Request body:

```json
{
  "fullName": "Alex Rivera",
  "email": "alex@example.com",
  "profileTypeId": "optional-uuid-or-null"
}
```

Rules:

- auth required
- tenant resolved server-side
- owner/admin only
- `Idempotency-Key` header required
- `fullName` required and trimmed
- `email` required and validated server-side
- `profileTypeId` optional, but if present must belong to the same tenant and be active

Responses:

- `201` on create
- `200` when the same idempotency key replays the stored result
- `403` for photographer
- `404` when a supplied type is not found in-tenant
- `409` when an active profile already exists for the normalized email

Payload:

```json
{
  "profile": {
    "id": "uuid",
    "fullName": "Alex Rivera",
    "email": "alex@example.com",
    "status": "active",
    "profileType": {
      "id": "uuid",
      "label": "Volunteer"
    }
  }
}
```

### `POST /api/profiles/[profileId]/archive`

Request body: none.

Rules:

- auth required
- tenant resolved server-side
- owner/admin only
- naturally idempotent

Responses:

- `200` when archived now or already archived
- `403` for photographer
- `404` if the profile is not in the tenant

### `POST /api/profile-types`

Request body:

```json
{
  "label": "Volunteer"
}
```

Rules:

- auth required
- tenant resolved server-side
- owner/admin only
- `Idempotency-Key` header required
- label required and normalized server-side

Responses:

- `201` on create
- `200` on idempotent replay
- `403` for photographer
- `409` when an active type already exists for the normalized label

### `POST /api/profile-types/[profileTypeId]/archive`

Request body: none.

Rules:

- auth required
- tenant resolved server-side
- owner/admin only
- naturally idempotent

Responses:

- `200` when archived now or already archived
- `403` for photographer
- `404` if the type is not in the tenant

Archiving a type must not null out or rewrite existing profile links.

## Exact `/profiles` page evolution

### Page structure

Keep the route and protected layout. Replace the shell with a real directory page that still preserves the module boundary that Profiles is separate from Projects.

### Header

- title remains `Profiles`
- explainer copy shifts from baseline-consent tracking to reusable recurring directory records
- retain a short boundary note that one-off project or event consent remains under `Projects`
- owner/admin header CTA: `Create profile`
- photographer sees a read-only hint instead of management CTA

### Summary cards

Replace all shell baseline cards with real directory metrics:

- `Active profiles`
- `Archived profiles`
- `Profile types`
- `Active profiles without type`

Do not keep any consent placeholder card in the summary row.

### Filters

Activate these filters now:

- search input for name or email
- profile type select
- include-archived checkbox

Do not keep a baseline-status filter in Feature 050.

Filter-state decision:

- use URL query params in the server-rendered page
- recommended params: `q`, `type`, `includeArchived=1`
- implement filters as a GET form so state is shareable, bookmarkable, and SSR-friendly

### Create UX

Decision: keep creation inline on `/profiles`, not on `/profiles/new`.

Recommended page section:

- owner/admin-only management band near the top of the page
- left: create-profile form with `full name`, `email`, optional `profile type`
- right: compact profile-type management card with active types and archive controls

This keeps the first real directory slice in one bounded module without inventing a separate settings surface.

### Table

Real columns:

- `Name`
- `Type`
- `Email`
- `Status`
- `Updated`
- `Actions`

Row rules:

- status shows `Active` or `Archived`
- rows with archived types still display the type label and an archived badge
- owner/admin get a live `Archive` action only for active profiles
- photographer gets no row mutation controls
- do not show row-level placeholder actions for consent requests yet

### Empty states

Use two real empty states:

- no profiles and no filters: explain the directory purpose and show create form for manage-capable users
- no results under current filters: explain that nothing matched and offer a reset-filters link

### Deferred section

Keep a low-emphasis deferred section at the bottom for:

- `Request baseline consent`
- `Send reminder`
- `Request extra consent`
- `Import profiles`
- `Sync directory`

All remain disabled. They should signal roadmap direction without implying live behavior.

## i18n plan

- Add all new UI text through `messages/en.json` and `messages/nl.json`.
- Do not hardcode new inline strings in components.
- Localize labels, buttons, helper text, summaries, empty states, badges, and validation messages.
- Do not localize stored domain values such as profile-type labels created by tenants.

## Security and reliability considerations

- tenant scope remains server-resolved only
- no client-provided tenant ids
- all writes stay owner/admin only
- photographer mutation attempts return `403`
- create-profile and create-type use `Idempotency-Key`
- archive-profile and archive-type are naturally idempotent
- normalized email uniqueness is enforced server-side and by database index
- type ownership is enforced server-side and by tenant-safe foreign-key rules
- archived types must not break existing linked profiles
- no fake mutation flows or misleading success states
- keep business logic in the service layer, not the browser

## Edge cases

- zero profile types: profile creation is still allowed because `profile_type_id` is optional
- zero profiles: page renders a real empty state, not a placeholder shell
- duplicate profile create with email differing only by case or outer spacing: return conflict against the active unique index
- duplicate type create race: one request wins, the other returns conflict
- duplicate create retry with the same idempotency key: return the stored success payload
- archive stale row: repeated archive returns the already archived row
- archived type still attached to profiles: rows continue to display that label, but the type is not available for new assignment
- archived profiles excluded by default: only visible when `includeArchived` is enabled
- no active results but archived matches exist: current filters still govern results; the page should not silently switch archives on

## Test plan

Minimum coverage for Feature 050:

- migration tests or direct DB assertions for:
  - active email uniqueness per tenant
  - archived profile reuse of normalized email
  - active type uniqueness per tenant
  - tenant-safe profile-type foreign-key behavior
- service tests for:
  - access control
  - normalization
  - idempotent create behavior
  - archive behavior
  - list/search/filter behavior
- route-handler tests for:
  - unauthenticated rejection
  - photographer `403`
  - conflict and validation responses
- page rendering tests for:
  - real empty state
  - manage-capable page with form and type-management card
  - photographer read-only rendering
  - real summary cards and real columns
- i18n-backed UI string coverage if existing tests touch rendered copy

## Implementation phases

1. Schema and RLS
   Add the two tables, indexes, tenant-safe foreign key, status constraints, and RLS policies.
2. Service layer and mutation routes
   Add the profiles directory service plus the four POST route handlers.
3. `/profiles` page conversion
   Replace the shell placeholders with real server-rendered summaries, filters, list, inline create form, and type-management card.
4. Tests and polish
   Add migration, service, route, and page coverage. Update translations and remove obsolete shell-only copy.

## Explicitly deferred follow-up cycles

- baseline recurring consent requests
- tokenized public recurring-profile signing
- recurring consent revocation
- reminders
- extra consent requests
- profile detail pages and history views
- bulk import
- external directory sync
- teams or groups
- notes
- headshots
- CompreFace integration
- project linking
- generic taxonomy or settings engines

## Concise implementation prompt

Implement Feature 050 as the first real recurring-profile directory slice. Add `recurring_profiles` and `recurring_profile_types` with tenant-scoped RLS, active-status uniqueness, and server-derived normalization. Keep `/profiles` as the protected route, convert it from the Feature 049 shell into a real server-rendered directory with inline owner/admin create flows, photographer read-only behavior, active search and type filtering, and low-emphasis disabled placeholders for future consent and import/sync actions. Use route handlers for mutations, service-layer logic for all business rules, and i18n keys in both English and Dutch for all new UI text.
