# Consent Form Template Editor Plan

## Inputs and ground truth

### Inputs read for this plan

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/003-consent-templates/research.md`
- `docs/rpi/003-consent-templates/plan.md`
- `docs/rpi/039-consent-form-template-editor/research.md`

### Verified current boundary

The current system already has these important properties and they remain in scope:

- `consent_templates` is a single global version-row table
- `subject_invites.consent_template_id` points to a concrete template row
- public signing snapshots `consent_text` and `consent_version` onto `consents`
- signed-consent reproducibility depends on `consents`, not a live template lookup
- there is no template CRUD UI or API today
- tenant roles exist in schema (`owner`, `admin`, `photographer`) but app behavior is mostly membership-based
- there is no platform-admin model in the current app

This plan extends that system. It does not replace it.

## Options considered

### Option A: Extend `consent_templates` with scope/ownership

Keep the existing table as the template version table, add tenant ownership and richer metadata, and keep invites/project defaults pointing at concrete version rows.

Why this wins:

- lowest migration risk
- preserves existing foreign keys and public-signing flow
- keeps signed-consent snapshot behavior unchanged
- smallest change that supports both app-wide and tenant-owned templates

### Option B: Separate app-wide and tenant-owned template tables

Rejected because:

- it breaks the current single-FK model
- it complicates invite/default references
- it adds union-query and migration overhead without solving the immediate product need better

### Option C: App-template base plus tenant fork/copy model

Rejected for this feature because:

- it introduces fork lineage, divergence, and sync questions too early
- it is future extensibility, not immediate scope

## Recommendation

Implement Option A.

- Extend the existing `consent_templates` table.
- Represent app-wide vs tenant-owned rows with nullable `tenant_id`.
- Keep template family identity implicit via scoped `template_key`.
- Keep `subject_invites.consent_template_id` and `projects.default_consent_template_id` pointing to specific version rows.
- Keep `consents.consent_text` and `consent_version` snapshot behavior unchanged.

Accepted tradeoffs:

- template family remains implicit instead of introducing a separate family table
- app-wide template management remains internal-only in this feature because no platform-admin model exists yet
- project/template relationship stays intentionally minimal

## Chosen architecture

## Structure

- `consent_templates` remains the canonical template version table.
- App-wide templates are rows where `tenant_id is null`.
- Tenant-owned templates are rows where `tenant_id = <tenant>`.
- Template family identity remains implicit as:
  - app-wide family: `(tenant_id is null, template_key)`
  - tenant family: `(tenant_id, template_key)`
- Concrete version identity remains the row `id`.
- `subject_invites.consent_template_id` continues to reference a specific version row.
- `projects.default_consent_template_id` continues to reference a specific version row.

## Why this structure is preferred

- it matches the live data model already in production
- it does not disturb the audit path that copies snapshots into `consents`
- it allows the app to show both app-wide and tenant-owned templates with a single query/helper
- it leaves room for later project eligibility sets or fork/copy behavior without forcing them now

## Explicit decisions

- `consent_templates` is extended, not replaced
- `template_key` remains the family key, but it becomes server-managed and non-editable
- invites/defaults remain version-row references, not family references
- project defaults do not auto-upgrade when newer versions are published
- one published version per family is enforced
- one draft version per family is enforced

## Schema changes

Create one migration that extends `public.consent_templates` and backfills existing rows.

## Table changes: `public.consent_templates`

Add columns:

- `tenant_id uuid null references public.tenants(id) on delete restrict`
- `name text not null`
- `description text null`
- `category text null`
- `version_number integer not null`
- `updated_at timestamptz not null default now()`
- `published_at timestamptz null`
- `archived_at timestamptz null`

Keep existing columns:

- `id`
- `template_key`
- `version`
- `body`
- `created_by`
- `created_at`

Reuse and expand existing column:

- keep `status`, but change allowed values from `('active','retired')` to `('draft','published','archived')`

## Version representation

Keep `version text` for compatibility and snapshot readability, but stop treating it as the source of ordering.

New source of ordering:

- `version_number integer not null`

Rule:

- `version` becomes a server-managed display label derived from `version_number`
- format: `v<version_number>`

Enforcement:

- add a check constraint that `version = 'v' || version_number::text`

This preserves existing text snapshots and avoids fragile lexicographic ordering.

## Family key

Keep `template_key text`, but make it server-managed and not user-editable.

Rules:

- existing app-wide seeded keys remain as-is
- new tenant template families get a generated opaque/stable key, not a user-editable slug

Reason:

- family identity must stay stable even if `name` changes
- user-facing identity should be `name`, not `template_key`

## Status/state model

Use:

- `draft`
- `published`
- `archived`

Visibility:

- invite/project selection uses only `published`
- old invites referencing `archived` rows continue to work because invite rows reference concrete version IDs

## Uniqueness

Drop current unique `(template_key, version)` constraint and replace it with partial unique indexes:

- global version uniqueness:
  - unique `(template_key, version_number)` where `tenant_id is null`
- tenant version uniqueness:
  - unique `(tenant_id, template_key, version_number)` where `tenant_id is not null`
- one global draft per family:
  - unique `(template_key)` where `tenant_id is null and status = 'draft'`
- one tenant draft per family:
  - unique `(tenant_id, template_key)` where `tenant_id is not null and status = 'draft'`
- one global published per family:
  - unique `(template_key)` where `tenant_id is null and status = 'published'`
- one tenant published per family:
  - unique `(tenant_id, template_key)` where `tenant_id is not null and status = 'published'`

## Indexes

Add selection and management indexes:

- `(tenant_id, status, updated_at desc)`
- `(status, updated_at desc)` where `tenant_id is null`
- `(tenant_id, template_key, version_number desc)`
- `(template_key, version_number desc)` where `tenant_id is null`

## Immutability rules

Add a DB trigger on `consent_templates`:

- drafts may update mutable fields:
  - `name`
  - `description`
  - `category`
  - `body`
  - `updated_at`
- published or archived rows may not change:
  - `tenant_id`
  - `template_key`
  - `version_number`
  - `version`
  - `name`
  - `description`
  - `category`
  - `body`
  - `created_by`
  - `created_at`
- published rows may transition only to `archived`
- archived rows may not transition back to `draft` or `published`
- drafts may transition to `published`

This keeps published history immutable while still allowing explicit archive actions.

## Backfill logic

Backfill existing rows as follows:

- `tenant_id = null`
- `name = initcap(replace(template_key, '-', ' '))`
- `description = null`
- `category = null`
- `version_number = parsed integer from `version` when it matches `^v[0-9]+$``
- fallback `version_number = row_number()` within `template_key` ordered by `created_at, id` if parsing fails
- `status = 'published'` when old status was `active`
- `status = 'archived'` when old status was `retired`
- `published_at = created_at` for backfilled published rows
- `archived_at = created_at` for backfilled archived rows
- `updated_at = created_at`

## RLS and role helper changes

Add helper function:

- `app.current_user_can_manage_templates(p_tenant_id uuid) returns boolean`

Behavior:

- true when `auth.uid()` has membership in `p_tenant_id` with role `owner` or `admin`

Update RLS on `consent_templates`:

- `SELECT`
  - allow authenticated users to read app-wide `published` rows
  - allow tenant members to read tenant-owned `published` rows for their tenant
  - allow tenant `owner/admin` to read tenant-owned rows in any state for their tenant
- `INSERT`
  - allow only tenant `owner/admin`
  - require inserted `tenant_id = current_tenant_id()`
  - no policy for `tenant_id is null`
- `UPDATE`
  - allow only tenant `owner/admin` on tenant-owned rows
  - no policy for app-wide rows

There is no client-facing delete route in this feature, so no delete policy is needed.

## Versioning and immutability model

## New template creation

Creating a new tenant template creates:

- a new family key (`template_key`)
- a first version row with:
  - `tenant_id = current tenant`
  - `version_number = 1`
  - `version = 'v1'`
  - `status = 'draft'`

Initial create fields:

- `name`
- `description`
- `category`
- `body`

## Draft editing

Drafts are editable in place.

Editable fields:

- `name`
- `description`
- `category`
- `body`

Not editable:

- `tenant_id`
- `template_key`
- `version_number`
- `version`
- `status` except via publish/archive endpoints

## New version creation

Creating a new version of an existing tenant-owned family:

- copies from the chosen source version row
- increments `version_number`
- derives `version = 'v' || version_number`
- creates a new `draft` row

Guard:

- only one draft per family
- if a draft already exists, return that draft instead of creating a second one

## Publishing

Publishing is a state transition on one draft row.

Publish transaction:

1. lock all rows in the target family
2. verify target row belongs to current tenant and is `draft`
3. set target row to:
   - `status = 'published'`
   - `published_at = now()`
   - `archived_at = null`
   - `updated_at = now()`
4. archive any other `published` row in the same family:
   - `status = 'archived'`
   - `archived_at = now()`
   - `updated_at = now()`

Result:

- exactly one published version per family

## Archiving

Archive action:

- allowed only on tenant-owned `published` rows
- transitions row to `archived`
- sets `archived_at = now()`
- does not mutate content

No unarchive action in this feature.

Reason:

- keeps state transitions simple
- avoids reviving stale selectable versions

## Effect on invites, projects, and consents

- existing invites keep the exact `consent_template_id` they were created with
- public signing keeps copying `body` and `version` into `consents`
- signed consents remain unchanged
- older invites can still sign against archived template rows they already reference
- project defaults remain specific-version pointers and do not auto-upgrade
- if a project default later points to an archived row, it remains stored but is no longer used as a valid default for new invites until updated

## App-wide vs tenant-owned template management

## App-wide templates

Storage:

- rows in `consent_templates` with `tenant_id is null`

Usage:

- directly usable by tenants in project defaults and invite selection

Management in this feature:

- internal-only
- managed by migrations or service-role/internal tooling
- no platform-admin UI or public app route is introduced in this feature

## Tenant-owned templates

Storage:

- rows in `consent_templates` with `tenant_id = current tenant`

Usage:

- visible to members of that tenant
- selectable in invite creation when `published`
- eligible for project default assignment when `published`

Management in this feature:

- tenant `owner` and `admin` can create, edit drafts, create new versions, publish, and archive
- tenant `photographer` cannot manage template content

## Project usage model

## Decision

Keep the project/template relationship minimal.

- keep only optional `projects.default_consent_template_id`
- include project default management in this feature
- keep invite creation explicit-template selection
- do not add a project-template eligibility join table

## Behavior

- invite creation form continues to render a template selector
- selector shows visible `published` templates from:
  - app-wide rows
  - current tenant rows
- if a valid project default exists, preselect it
- if no valid project default exists, the user must select a template
- remove the hardcoded server fallback to the latest `gdpr-general` template for missing selection

Reason:

- hardcoded fallback becomes risky once multiple app-wide and tenant-owned templates exist
- explicit selection or explicit project default is more predictable

## Project default management

Include a minimal project-default control on the project page.

Rules:

- only `published` visible templates may be assigned as project default
- clearing the default is allowed
- if current default is archived or no longer visible, show a warning and require re-selection

## Template editor scope

## Included in this feature

- template list page in protected area
- create tenant template flow
- draft editing
- create new version from an existing tenant template family
- publish action
- archive action
- minimal project default selector
- invite selection UI updated for app-wide + tenant-owned published templates

## Template fields in scope

- `name`
- `description`
- `category`
- `version` label, but read-only and system-generated from `version_number`
- `body`
- status actions: `draft`, `published`, `archived`

## Explicitly deferred

- dynamic form builder behavior
- arbitrary structured field schemas
- template-driven purposes/channels/scopes
- template-driven checkbox schemas
- template-driven invite expiry defaults
- template-driven biometric consent sections
- signer-role workflows

## Specialized templates

Represent specialized templates as:

- normal template content
- optional lightweight `category` metadata

Examples:

- standard adult: `category = 'adult'`
- minor/parent: `category = 'minor-parent'`
- campaign-specific: `category = 'campaign'`

Important scope boundary:

- `category` is descriptive only in this feature
- it does not introduce guardian-signature workflow, multi-signer workflow, or special public form behavior

## API changes

All new write endpoints are protected server routes. They derive tenant and role server-side. They never accept client-provided `tenant_id`.

## Shared helpers

Add server helpers under `src/lib/templates/`:

- `listVisibleTemplatesForTenant`
- `listManageableTemplatesForTenant`
- `getTemplateForManagement`
- `createTenantTemplate`
- `createTenantTemplateVersion`
- `updateDraftTemplate`
- `publishTenantTemplate`
- `archiveTenantTemplate`
- `setProjectDefaultTemplate`
- `resolveTemplateManagementAccess`

These helpers should centralize tenant resolution, role enforcement, and row-state validation.

## Read endpoints

### `GET /api/templates`

Purpose:

- return visible published templates for the current tenant for selectors/client refreshes

Auth:

- authenticated tenant member required

Query behavior:

- returns app-wide `published` rows plus current tenant `published` rows

Response shape:

```json
{
  "templates": [
    {
      "id": "uuid",
      "scope": "app",
      "name": "string",
      "description": "string|null",
      "category": "string|null",
      "templateKey": "string",
      "version": "v2",
      "versionNumber": 2,
      "status": "published"
    }
  ]
}
```

Status codes:

- `200`
- `401`
- `403`

### `GET /api/templates/[templateId]`

Purpose:

- return one template version row for management/detail view

Auth:

- authenticated required
- tenant `owner/admin` for tenant-owned draft/archived rows
- any tenant member may read visible published rows that belong to their tenant or are app-wide

Response shape:

```json
{
  "template": {
    "id": "uuid",
    "scope": "tenant",
    "tenantId": "uuid|null",
    "name": "string",
    "description": "string|null",
    "category": "string|null",
    "templateKey": "string",
    "version": "v2",
    "versionNumber": 2,
    "status": "draft",
    "body": "string",
    "createdAt": "iso",
    "updatedAt": "iso",
    "publishedAt": "iso|null",
    "archivedAt": "iso|null",
    "canEdit": true,
    "canPublish": true,
    "canArchive": false
  }
}
```

Status codes:

- `200`
- `401`
- `403`
- `404`

## Write endpoints

### `POST /api/templates`

Purpose:

- create a new tenant-owned draft template family

Auth:

- tenant `owner/admin`

Headers:

- require `Idempotency-Key`

Request shape:

```json
{
  "name": "string",
  "description": "string|null",
  "category": "string|null",
  "body": "string"
}
```

Response shape:

```json
{
  "template": {
    "id": "uuid",
    "templateKey": "string",
    "version": "v1",
    "versionNumber": 1,
    "status": "draft"
  }
}
```

Status codes:

- `201`
- `400` invalid input
- `401`
- `403`
- `409` idempotency collision or family-create conflict

### `PATCH /api/templates/[templateId]`

Purpose:

- update a tenant-owned draft row

Auth:

- tenant `owner/admin`

Request shape:

```json
{
  "name": "string",
  "description": "string|null",
  "category": "string|null",
  "body": "string"
}
```

Behavior:

- only draft rows may be updated
- app-wide rows are never editable

Status codes:

- `200`
- `400`
- `401`
- `403`
- `404`
- `409` `template_not_editable`

### `POST /api/templates/[templateId]/versions`

Purpose:

- create the next draft version for an existing tenant-owned family

Auth:

- tenant `owner/admin`

Headers:

- require `Idempotency-Key`

Request shape:

- empty body

Behavior:

- if draft already exists for the family, return that draft with `200`
- otherwise create next version draft from the source row

Response shape:

```json
{
  "template": {
    "id": "uuid",
    "templateKey": "string",
    "version": "v3",
    "versionNumber": 3,
    "status": "draft"
  },
  "reusedExistingDraft": false
}
```

Status codes:

- `200` reused existing draft
- `201` created new draft
- `401`
- `403`
- `404`
- `409` invalid source or non-tenant-owned row

### `POST /api/templates/[templateId]/publish`

Purpose:

- publish one draft version and archive any previously published version in the same family

Auth:

- tenant `owner/admin`

Request shape:

- empty body

Behavior:

- idempotent if already published
- conflict if row is archived or not tenant-owned

Status codes:

- `200`
- `401`
- `403`
- `404`
- `409`

### `POST /api/templates/[templateId]/archive`

Purpose:

- archive a published tenant-owned version

Auth:

- tenant `owner/admin`

Request shape:

- empty body

Behavior:

- idempotent if already archived
- conflict if row is draft

Status codes:

- `200`
- `401`
- `403`
- `404`
- `409`

### `PATCH /api/projects/[projectId]/default-template`

Purpose:

- set or clear `projects.default_consent_template_id`

Auth:

- authenticated tenant member with project access
- additionally require `owner/admin` for this config change

Request shape:

```json
{
  "defaultConsentTemplateId": "uuid|null"
}
```

Behavior:

- `null` clears the default
- non-null value must be a visible `published` template row belonging to:
  - app-wide scope, or
  - current tenant

Status codes:

- `200`
- `400`
- `401`
- `403`
- `404`
- `409` if selected template is not currently usable as a default

## UI changes

## Protected navigation

Add a new primary nav item:

- `/templates`

## Template management page

Add:

- `src/app/(protected)/templates/page.tsx`

Behavior:

- owner/admin only
- list tenant-owned template families and latest versions
- list app-wide published templates in a separate read-only section
- include a create-template form for tenant templates

UI sections:

- "Organization templates"
- "Standard app templates"

For organization templates, show:

- name
- category
- current latest draft or published version
- status badge
- updated/published date
- actions:
  - edit draft
  - create new version
  - publish
  - archive

For app-wide templates, show:

- name
- description
- category
- version
- read-only preview link or inline summary

## Template detail/editor page

Add:

- `src/app/(protected)/templates/[templateId]/page.tsx`

Behavior:

- owner/admin only for tenant-owned draft/archived management
- published app-wide rows may be shown read-only if linked from UI, but no edit controls

Draft detail page includes:

- editable fields:
  - name
  - description
  - category
  - body
- read-only fields:
  - version
  - scope
- actions:
  - save draft
  - publish

Published/archived tenant rows include:

- read-only content display
- create new version action
- archive action for published rows

## Project page updates

Update `src/app/(protected)/projects/[projectId]/page.tsx`:

- template selector should show app-wide and tenant-owned published templates
- display `name` first, not `template_key`
- mark scope in the option label:
  - `Standard`
  - `Organization`
- add minimal project default template form/control
- show warning when current default points to an archived or otherwise unusable row

## Invite creation form updates

Update `src/components/projects/create-invite-form.tsx`:

- require explicit selection when there is no valid default
- group or label options by scope
- use human name + version label

## Security and authorization

## Tenant scoping

- never accept `tenant_id` from the client
- derive tenant from authenticated session + membership
- validate every template write against the derived tenant

## Template visibility

- app-wide templates:
  - readable when `published`
  - never editable through tenant routes
- tenant-owned published templates:
  - readable by members of the same tenant
- tenant-owned draft/archived templates:
  - readable and manageable only by tenant `owner/admin`

## Who can create/edit/publish/archive tenant templates

- `owner`
- `admin`

## Who can use templates in invites/projects

- all current tenant members with project access
- in current role model this means `owner`, `admin`, and `photographer`

## Role-aware checks

Add role-aware checks only for:

- new template-management routes
- project default update route

Do not broaden role enforcement across unrelated existing routes in this feature.

## Safe auth/error behavior

- `401` for unauthenticated
- `403` for authenticated but not allowed to manage templates
- `404` when the requested template/version/project is not visible in the caller’s scope
- `409` for invalid state transitions or stale selections

This prevents leaking other tenants’ template rows.

## Migration and compatibility

## Migration strategy

1. Extend `consent_templates` schema and backfill existing rows.
2. Update RLS and helper functions.
3. Update server queries to use:
   - `status = 'published'`
   - app-wide or current-tenant visibility
   - `version_number` for ordering
4. Update invite/project UI and routes.
5. Add template management UI and write routes.

## Existing rows

Existing app-wide rows become:

- `tenant_id = null`
- `status = 'published'` or `archived`
- existing IDs preserved

## Existing foreign keys

Remain unchanged:

- `subject_invites.consent_template_id`
- `projects.default_consent_template_id`

This preserves compatibility with old invites and existing project defaults.

## Public consent flow compatibility

Keep public RPC behavior compatible:

- `get_public_invite` continues to join the linked template row by ID
- `submit_public_consent` continues to copy `body` and `version` into `consents`
- do not add status filtering to the public RPC joins for invite-linked rows

Reason:

- older invites pointing to archived versions must still reproduce the originally intended version

## Transitional query logic

No temporary dual-read path is needed if migration and app updates ship together.

Required code updates:

- replace `status = 'active'` selection logic with `status = 'published'`
- replace `order by version desc` with `order by version_number desc`
- replace UI labels based on `template_key` with `name`

## Retry safety and concurrency

## Create template

- require `Idempotency-Key`
- store response in `idempotency_keys` with operation `create_tenant_template`
- duplicate request returns the same created draft

## Create version

- require `Idempotency-Key`
- use transaction with family-row lock
- if draft already exists, return that draft
- otherwise create next version draft exactly once

## Publish

- publish route is idempotent
- transaction locks family rows before changing states
- unique partial index on published row per family prevents double-publish races
- if two users publish competing drafts concurrently, one wins and the other gets a conflict/reload result

## Archive

- archive route is idempotent
- repeated archive requests return the archived state

## Invite preparation while template changes

- selector shows only currently published visible rows
- invite create route revalidates selected row at write time
- if row was archived or became unavailable after page load, route returns `409 template_not_available`
- because invites store concrete version row IDs, later template changes do not affect already-created invites

## Edge cases

- No templates available for a tenant/project:
  - invite form shows empty state and blocks create
  - project default control shows no options
- Archived template referenced by older invite:
  - public invite still resolves and signs against that exact row
- Project default later becomes archived:
  - keep FK value
  - show warning on project page
  - do not silently fall back to another template
- Attempt to mutate published template in place:
  - blocked by route validation and DB trigger
- Attempt to use another tenant’s template:
  - blocked by selector query, route validation, RLS, and safe `404/409`
- App-wide template visibility vs editability:
  - visible to tenants when published
  - never editable from tenant UI
- Old invites referencing older published versions:
  - continue to work
  - continue to snapshot exact version text
- Tenant user trying to edit app-wide template:
  - return `404` or `403` from management route
- Existing project default missing/invalid:
  - project page warns
  - invite create requires explicit valid selection

## Testing plan

## Migration verification

- `supabase db reset`
- verify backfilled columns and status mapping
- verify existing seeded rows preserved IDs and become app-wide

## Schema/RLS tests

Add tests that cover:

- tenant member can read visible published tenant template rows only for their tenant
- tenant owner/admin can read tenant draft and archived rows
- photographer cannot create/update/publish/archive tenant templates
- no authenticated tenant client can write app-wide rows
- tenant cannot read another tenant’s draft/archived rows

## Authorization tests

Route tests for:

- create template allowed for owner/admin, rejected for photographer
- update draft allowed for owner/admin only
- publish/archive allowed for owner/admin only
- project default update allowed for owner/admin only

## Template lifecycle tests

- create draft v1
- edit draft
- publish draft
- create new draft version from published row
- publish new version archives previous published row
- archive published row
- published rows cannot be edited in place

## Project/invite integration tests

- visible selection includes app-wide published + tenant-owned published
- archived and draft rows are excluded from invite selection
- project default preselects correctly
- invalid/archived default produces warning and no silent fallback
- invite create stores selected `consent_template_id`

## Signed-consent compatibility tests

- public invite page renders linked template body/version
- public signing snapshots `body` and `version` into `consents`
- receipt email still uses consent snapshot
- old invite referencing archived version still signs the archived row snapshot

## Compatibility tests

- existing app-wide template IDs remain valid after migration
- existing project default FKs remain valid
- existing invite FKs remain valid
- old code assumptions replaced:
  - `published` instead of `active`
  - `version_number` ordering instead of `version` text ordering

## Conflict and retry tests

- duplicate create-template request with same idempotency key returns same draft
- duplicate create-version request returns same draft
- concurrent create-version attempts produce one draft
- duplicate publish request is idempotent
- concurrent publish attempts on same family produce one published winner
- invite create against stale archived template returns conflict

## Implementation phases

### Phase 1: Schema and compatibility

- extend `consent_templates`
- backfill existing rows
- add indexes, constraints, trigger, role helper, and RLS policies
- update any query assumptions from `active/retired` to `draft/published/archived`

### Phase 2: Server helpers and write routes

- add `src/lib/templates/*`
- add create/update/version/publish/archive/default helpers
- add route handlers under `src/app/api/templates/**`
- add project default update route

### Phase 3: Template management UI

- add `/templates`
- add `/templates/[templateId]`
- add navigation item
- add create and draft-edit forms

### Phase 4: Project/invite integration

- update project page template loading
- add project default UI
- update invite creation selector and validation
- remove hardcoded fallback-to-gdpr behavior

### Phase 5: Regression coverage and polish

- add lifecycle, auth, RLS, integration, and compatibility tests
- confirm `supabase db reset`
- run lint/tests
- fix any copy or UX issues discovered during verification

## Scope boundaries

This feature does **not** include:

- a full dynamic consent form builder
- template-driven biometric form logic
- eligible-template-per-project workflow
- photographer template-picking workflow beyond current invite-time explicit selection
- signer-role / guardian-signature workflow
- app-wide template forking/copying
- a platform-admin UI
- unrelated consent-system redesign

## Concise implementation prompt

Implement Feature 039 by extending the existing `consent_templates` table, not replacing it. Add nullable `tenant_id`, human metadata (`name`, `description`, `category`), internal `version_number`, and a `draft/published/archived` lifecycle while keeping `version` as a server-generated display label (`vN`). Keep template family identity implicit via scoped `template_key`. Preserve `subject_invites.consent_template_id` and `projects.default_consent_template_id` as concrete version-row FKs, and keep signed-consent auditability anchored on `consents.consent_text` and `consent_version` snapshots. Add tenant-owned template CRUD for `owner/admin` only, keep app-wide template management internal-only, add a minimal `/templates` management UI and a project default selector, update invite selection to show published app-wide plus tenant-owned templates, remove hardcoded fallback selection, and cover migration, RLS, auth, lifecycle, integration, and snapshot-compatibility behavior with tests.
