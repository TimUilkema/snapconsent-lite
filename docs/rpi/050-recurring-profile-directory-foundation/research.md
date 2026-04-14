# Feature 050 Research: Recurring Profile Directory Foundation

## Scope

Research the first real backend-enabled cycle for the recurring profiles module.

This cycle should move the module beyond the Feature 049 shell and add a production-safe tenant-scoped directory foundation for recurring people. It should stay intentionally bounded:

- real recurring profile records
- protected list and create flows
- profile archiving
- real search and filter behavior
- lightweight tenant-managed classification metadata

This is not the recurring consent-request feature yet.

## Inputs reviewed

### Required docs

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/049-recurring-profiles-and-consent-management-foundations/research.md`
- `docs/rpi/049-recurring-profiles-and-consent-management-foundations/plan.md`

### Live implementation files verified

- `src/app/(protected)/layout.tsx`
- `src/components/navigation/protected-nav.tsx`
- `src/app/(protected)/profiles/page.tsx`
- `src/components/profiles/profiles-shell.tsx`
- `src/lib/profiles/profile-access.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/templates/template-service.ts`
- `src/app/api/templates/route.ts`
- `src/app/api/projects/route.ts`
- `src/components/projects/create-project-form.tsx`
- `src/lib/http/errors.ts`
- `messages/en.json`
- `messages/nl.json`
- `tests/feature-049-recurring-profiles-shell.test.ts`
- `tests/helpers/supabase-test-client.ts`

### Live schema and migration references verified

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260304211000_002_projects_invites_rls.sql`
- `supabase/migrations/20260304212000_002_projects_invites_idempotency.sql`
- `supabase/migrations/20260407150000_039_consent_form_template_editor.sql`
- `supabase/migrations/20260410190000_drop_template_category.sql`

## Verified current live boundary after Feature 049

## 1. The Profiles module now exists only as a protected shell

Feature 049 is live in the app as:

- nav entry: `Profiles`
- protected route: `/profiles`
- shell component: `src/components/profiles/profiles-shell.tsx`
- server-side access helper: `src/lib/profiles/profile-access.ts`

Current live behavior:

- the route is protected under `(protected)`
- tenant resolution still happens server-side
- all tenant members with a membership can view the shell
- only `owner` and `admin` are marked manage-capable in the shell
- `photographer` is read-only
- all actions are disabled placeholders

There are still no recurring-profile schema objects, API routes, or service-layer writes.

## 2. Current `/profiles` UI is intentionally non-functional

The current page shows:

- recurring-profile explainer copy
- placeholder summary cards
- disabled search and filters
- empty-state table shell
- disabled future actions for baseline consent, reminders, import, and sync

Important implication:

- Feature 050 should reuse the protected module location and permission boundary
- but it should replace shell placeholders only where the directory foundation is actually becoming real

## 3. Role boundary is already established in live code

`src/lib/profiles/profile-access.ts` currently resolves:

- `owner`: view and manage
- `admin`: view and manage
- `photographer`: view only

This matches the current template-management boundary in `src/lib/templates/template-service.ts`, where only `owner` and `admin` can manage templates.

Current repo pattern therefore supports:

- all tenant members can read some tenant-scoped protected data
- only owner/admin perform operational writes for higher-trust module administration

## 4. Current protected UI and i18n foundations are reusable

Relevant current patterns:

- protected pages are server-rendered
- page structure uses `app-shell` and `content-card`
- i18n keys live in `messages/en.json` and `messages/nl.json`
- `profiles` already has a translation namespace for module copy
- client-side forms localize API errors through the existing `errors` namespace

Feature 050 should extend those patterns rather than add hardcoded copy or a separate configuration area.

## 5. Current backend patterns are split between simple and idempotent writes

Current live references:

- `src/app/api/projects/route.ts` creates projects directly without an explicit idempotency key
- `src/app/api/templates/route.ts` requires an `Idempotency-Key` header for create
- `src/lib/templates/template-service.ts` persists request responses into `public.idempotency_keys`

Implication for Feature 050:

- list reads can stay simple
- create profile should use a retry-safe idempotent write path
- archive profile can be written to be naturally idempotent by returning the already-archived row

## 6. No recurring-profile API routes exist yet

Confirmed current state:

- no `src/app/api/profiles/**`
- no recurring profile service other than the access helper
- no recurring-profile tables or migrations

Feature 050 is therefore the first backend-enabled recurring-profile cycle, not a refinement of an existing backend.

## Current routes, components, and helpers to reuse

### Protected shell and access

- `src/app/(protected)/layout.tsx`
- `src/components/navigation/protected-nav.tsx`
- `src/app/(protected)/profiles/page.tsx`
- `src/components/profiles/profiles-shell.tsx`
- `src/lib/profiles/profile-access.ts`

### Tenant and auth resolution

- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/supabase/server.ts`

### Error and route conventions

- `src/lib/http/errors.ts`
- `src/app/api/templates/route.ts`
- `src/app/api/projects/route.ts`

### Owner/admin management pattern

- `src/lib/templates/template-service.ts`

### i18n structure

- `messages/en.json`
- `messages/nl.json`

### Test pattern references

- `tests/feature-049-recurring-profiles-shell.test.ts`
- `tests/helpers/supabase-test-client.ts`

## Directory-model options considered

## Option A: Add only `recurring_profiles` with free-text metadata on the profile row

Possible shape:

- `recurring_profiles.full_name`
- `recurring_profiles.email`
- `recurring_profiles.profile_type_label`
- `recurring_profiles.team_label`

Pros:

- smallest schema footprint
- simplest create form
- no extra lookup tables

Cons:

- duplicate spelling drift
- weak filter consistency
- no clean tenant-owned classification management
- later rename or archive of a label is hard
- high risk of fragmented values like `volunteer`, `Volunteer`, `volunteers`

Conclusion:

- reject
- this is too weak for a tenant-managed directory, especially because classification is a central goal of the cycle

## Option B: Add `recurring_profiles` plus specific tenant-managed lookup tables

Possible shape:

- `recurring_profiles`
- `recurring_profile_types`
- possibly later `recurring_profile_teams`

Pros:

- keeps recurring profiles as a real parallel domain
- allows clean filtering and consistent labels
- keeps tenant-owned configuration inside the app
- avoids platform-admin setup dependency
- remains explicit and easy to query

Cons:

- requires a small management surface for the lookup table
- adds some schema and route surface beyond just profiles

Conclusion:

- recommended
- but keep it bounded to one lookup category in Feature 050

## Option C: Add one generic tenant-managed taxonomy table now

Possible shape:

- `tenant_taxonomy_values`
- column such as `kind in ('profile_type', 'team')`

Pros:

- can support multiple categories later
- avoids duplicating table shape when the second category arrives

Cons:

- overgeneralizes before the second category is actually live
- pushes the feature toward a generic settings engine too early
- makes naming, validation, and UI copy less concrete

Conclusion:

- reject for Feature 050
- reconsider only after at least two real tenant-managed classification categories are proven necessary

## Classification-model options considered

## Option A: Free-text `profile_type_label` on each profile

Best argument for it:

- smallest possible create flow

Why it is still a poor fit:

- undermines filtering quality immediately
- makes tenant-managed configuration impossible in any meaningful sense
- pushes dedupe and normalization work into later cleanup migrations

Recommendation:

- reject

## Option B: Tenant-managed `recurring_profile_types`

Best argument for it:

- smallest bounded model that still gives tenants ownership of their own taxonomy
- directly supports the existing shell `Type` column and filter
- keeps terminology clear and concrete in schema, routes, and UI

Recommendation:

- recommend for Feature 050

## Option C: Tenant-managed `recurring_profile_types` plus `recurring_profile_teams`

Best argument for it:

- captures both person role and organizational grouping early

Why it is probably too much for this cycle:

- doubles management surface
- adds a second taxonomy before the first is proven in real usage
- requires more list filters, form fields, and archive behavior
- shell and current module copy already anticipate `Type`, not `Team`

Recommendation:

- defer teams or groups

## Option D: Generic tenant taxonomy now

Why it is attractive:

- looks flexible on paper

Why it is still not recommended:

- too abstract for the first real directory cycle
- blurs the boundary between recurring-profile foundation and generic settings infrastructure

Recommendation:

- defer

## Recommendation for the smallest coherent backend-enabled slice

Feature 050 should implement the first real recurring-profile directory foundation with exactly these real capabilities:

- real `recurring_profiles` records
- real `recurring_profile_types` records
- protected list page backed by database reads
- real create profile flow for owner/admin
- real archive profile flow for owner/admin
- real profile-type creation for owner/admin
- real search and type filtering
- real include-archived filtering

Everything else should remain deferred.

## What should be in Feature 050

- tenant-scoped recurring profile table
- tenant-scoped recurring profile type lookup table
- RLS and indexes for both
- service-layer read and write helpers
- protected `/profiles` page backed by server reads
- owner/admin create profile form
- owner/admin archive profile action
- real type filter
- lightweight owner/admin type-management surface
- i18n-backed labels and validation copy
- tests for schema behavior, access behavior, and service behavior

## What should not be in Feature 050

- recurring consent request tables
- baseline consent status derivation
- public signing
- revoke flows
- reminders
- extra consent requests
- bulk import
- external directory sync
- profile detail pages
- teams or groups
- generic settings engine
- generic custom fields
- notes field

## Should Feature 050 include both profile types and teams

Recommended answer:

- include profile types now
- defer teams or groups

Why:

- profile type is already anticipated by the live shell
- type is the strongest minimum classification axis for a recurring people directory
- adding teams now would double lookup-table management, form fields, list filters, and archive semantics
- team, group, department, chapter, and board-style segmentation are likely to need more product validation before committing to one bounded model

Future direction:

- if a second classification axis becomes clearly necessary, add a second specific table such as `recurring_profile_teams`
- only revisit a generic taxonomy design if two or more real tenant-managed label categories are live and demonstrably parallel

## Recommended schema direction

## 1. `public.recurring_profile_types`

Recommended purpose:

- tenant-owned lookup values for recurring profile classification

Recommended bounded fields:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete cascade`
- `label text not null`
- `normalized_label text not null`
- `status text not null default 'active' check (status in ('active', 'archived'))`
- `created_by uuid not null references auth.users(id) on delete restrict`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `archived_at timestamptz null`

Recommended constraints and indexes:

- unique active label per tenant by normalized form
- index on `(tenant_id, status, label)`

Recommended normalization:

- trim label
- collapse empty string to invalid
- store `normalized_label = lower(trim(label))`

Recommended lifecycle:

- active types can be assigned to profiles
- archived types stay visible on already-linked profiles
- archived types are hidden from the default create-form selector

## 2. `public.recurring_profiles`

Recommended purpose:

- tenant-scoped reusable recurring person records

Recommended bounded fields:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete restrict`
- `profile_type_id uuid null references public.recurring_profile_types(id) on delete set null`
- `full_name text not null`
- `email text null`
- `status text not null default 'active' check (status in ('active', 'archived'))`
- `created_by uuid not null references auth.users(id) on delete restrict`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `archived_at timestamptz null`

Recommended v1 omissions:

- no team/group field
- no notes field
- no baseline consent fields
- no derived consent status columns
- no project linkage fields

## 3. Required versus optional profile fields

Recommended v1 requirements:

- `full_name`: required
- `profile_type_id`: optional
- `email`: optional

Why `email` should be optional:

- Feature 049 already identified future copyable-link flows that should not require email
- some recurring profiles may be created before contact details are known
- this keeps the directory foundation reusable outside email-first workflows

Why `profile_type_id` should be optional in v1:

- tenants may want to start creating profiles before they define types
- forcing taxonomy creation first is avoidable friction

## 4. Email uniqueness

Recommended direction:

- treat email as normalized lower-case when present
- strongly consider a partial unique index for active rows only:
  - unique `(tenant_id, lower(email))` where email is not null and status = 'active'`

Why this is attractive:

- reduces accidental duplicates
- helps later recurring consent request flows
- keeps archived rows from blocking recreation when appropriate

Tradeoff:

- some organizations may have shared addresses

Plan-phase note:

- confirm whether the product wants "one active recurring profile per email" as a hard rule
- if not, keep email non-unique and rely on idempotency only

## 5. RLS and helper direction

Recommended RLS shape:

- select allowed for any tenant member
- insert and update restricted to authenticated tenant members, with server-side role enforcement still required
- tenant isolation enforced by `memberships`

Recommended server-side enforcement:

- keep owner/admin management checks in service code
- do not rely on client role awareness
- keep photographer read-only at the service and route layer

## Recommended permission model

Recommended v1 access model:

- `owner`: view, create, archive, manage types
- `admin`: view, create, archive, manage types
- `photographer`: view only

Why this fits the live repo:

- matches Feature 049 access helper
- matches template-management trust level
- avoids role redesign

Recommended bounded rule:

- all tenant members can view the recurring profile directory
- only owner/admin can mutate profiles or type labels

## Recommended `/profiles` page evolution

## 1. What becomes real now

Feature 050 should turn these parts of the page real:

- search
- type filter
- include archived toggle
- real list rows
- real create profile flow
- real archive action
- real type selector
- real type creation for owner/admin

## 2. What should remain placeholder-only

These should remain disabled or absent because the backend domain does not exist yet:

- `Request baseline consent`
- `Resend baseline request`
- `Send reminder`
- `Request extra consent`
- any baseline consent status badges
- import and sync actions

## 3. Summary cards should evolve away from fake baseline counts

The shell currently shows baseline-consent-oriented cards. Feature 050 should not keep fake or permanently zero baseline cards once the page has real data.

Recommended real summary cards for Feature 050:

- `Active profiles`
- `Archived profiles`
- `Profiles with email`
- `Active profile types`

Reason:

- these are truthful directory metrics
- they do not imply consent-request functionality that does not yet exist

This is a justified evolution of the shell, not a product-boundary change.

## 4. Real table columns for Feature 050

Recommended real columns:

- `Name`
- `Type`
- `Email`
- `Status`
- `Updated`
- `Actions`

Why not keep the shell's baseline-request columns:

- `Baseline status`, `Latest request`, and `Last consent activity` would still be fake in Feature 050
- replacing them now avoids misleading partially-real UI

## 5. Real filters for Feature 050

Recommended live filters:

- text search across `full_name` and `email`
- `Type` filter
- `Include archived` toggle

Recommended deferred filters:

- team/group
- consent status
- request status

## 6. Create UX recommendation

The most bounded real create experience is:

- keep everything on `/profiles`
- replace the disabled header CTA with a real owner/admin create form card
- use the same general pattern as `CreateProjectForm` rather than a modal

Why:

- matches current repo UI conventions
- avoids modal complexity
- keeps create and list in one protected page

## 7. Type-management UX recommendation

Smallest clean option:

- add a compact owner/admin `Profile types` management card on the `/profiles` page
- allow adding a type label
- show active types in a small list
- defer rename and complex reordering

This is enough to satisfy "tenant admins can define their own structures" without inventing a full settings module.

## Security and reliability considerations

- derive tenant on the server with `resolveTenantId(...)`
- never accept tenant id from the client
- use server-side access checks for create and archive
- keep all new routes behind authenticated server handlers
- use parameterized Supabase query builder calls only
- make create profile retry-safe with idempotency
- make archive naturally idempotent by returning the archived row if already archived
- validate `profile_type_id` belongs to the current tenant before insert or update
- hide archived types from create selectors by default, but preserve existing profile references
- keep photographer mutation attempts returning `403`

## Reliability and race cases to handle

### Duplicate create requests

Recommended direction:

- require `Idempotency-Key` on `POST /api/profiles`
- persist the created profile response in `public.idempotency_keys`

### Duplicate type creation

Recommended direction:

- unique normalized active label per tenant
- on conflict, return the existing row or a clear `409`, depending on the chosen API ergonomics

### Stale archive actions

Recommended direction:

- archiving an already archived profile should succeed idempotently
- UI should refresh from server after archive

### Partial failure

Feature 050 has no delivery side effects, so the main partial-failure surface is:

- row created but client never received the response

That is exactly why idempotent create is worth adding now.

## Edge cases

- tenant has zero profile types and starts creating profiles immediately
- tenant has zero profiles and only photographers viewing the page
- profile created without email
- profile created without type
- two admins create the same type label concurrently
- two admins submit the same create-profile request after a network retry
- admin archives a profile while another browser still shows it as active
- archived type remains attached to an existing profile
- archived profiles should stay excluded unless `includeArchived` is enabled
- search query plus archived toggle should behave predictably when there are zero active results but archived matches exist

## Explicitly deferred work

- recurring consent request domain
- baseline consent statuses derived from real requests
- public signing and revoke
- request reminders
- extra consent requests
- profile detail pages
- teams or groups
- notes field
- bulk import
- external directory sync
- headshots
- CompreFace or provider identity binding
- project linkage
- generic taxonomy engine
- generic settings engine
- generic custom fields

## Open decisions for the plan phase

- Should Feature 050 enforce one active profile per normalized email within a tenant, or keep email non-unique in v1?
- Should `profile_type_id` remain optional in v1, or should the product require admins to define at least one type before create?
- Should type management in Feature 050 include only create, or create plus archive?
- If a type is archived, should the list filter still show it when there are profiles linked to it?
- Should the `/profiles` page use URL query params for search and filter state, or keep filter submissions local to the page request in a smaller first cut?
- Should summary cards switch fully to directory metrics now, or keep one minimal placeholder for future consent tracking copy?
- Should the first real create flow live inline on `/profiles`, or should it use a dedicated `/profiles/new` route despite the repo's current preference for inline management forms?

## Research conclusion

The smallest coherent Feature 050 is:

- one new tenant-scoped `recurring_profiles` table
- one new tenant-scoped `recurring_profile_types` lookup table
- list, create, archive, search, and type filter
- owner/admin type definition in the module itself
- photographer read-only visibility

The key bounded product decision is to support tenant-managed profile types now, but not teams and not a generic taxonomy engine. That gives the recurring profiles module a real reusable directory foundation while keeping consent requests, reminders, import, and sync out of this cycle.
