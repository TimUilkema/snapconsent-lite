# Feature 080 Research - Advanced organization access management foundation

## Inputs reviewed

Required inputs reviewed in the requested order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `UNCODEXIFY.md`
5. `docs/rpi/README.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/research.md`
8. `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/plan.md`
9. `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/research.md`
10. `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/plan.md`
11. `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/research.md`
12. `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/plan.md`
13. `docs/rpi/074-project-release-package-and-media-library-placeholder/research.md`
14. `docs/rpi/074-project-release-package-and-media-library-placeholder/plan.md`
15. `docs/rpi/075-project-correction-and-re-release-foundation/research.md`
16. `docs/rpi/075-project-correction-and-re-release-foundation/plan.md`
17. `docs/rpi/076-correction-consent-intake-and-authorization-updates/research.md`
18. `docs/rpi/076-correction-consent-intake-and-authorization-updates/plan.md`
19. `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/research.md`
20. `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/plan.md`
21. `docs/rpi/078-organization-scoped-media-library-folders-and-organization-foundation/research.md`
22. `docs/rpi/078-organization-scoped-media-library-folders-and-organization-foundation/plan.md`
23. `docs/rpi/079-project-correction-media-intake-and-release-asset-additions/research.md`
24. `docs/rpi/079-project-correction-media-intake-and-release-asset-additions/plan.md`

All later listed 070-079 RPI files existed in the live repo at research time. No requested prior RPI file was missing.

Live source of truth inspected:

- Schema and RLS
  - `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
  - `supabase/migrations/20260304211000_002_projects_invites_rls.sql`
  - `supabase/migrations/20260423090000_070_tenant_rbac_membership_invites_foundation.sql`
  - `supabase/migrations/20260423110000_070_tenant_membership_invite_flows.sql`
  - `supabase/migrations/20260423120000_072_project_workspaces_foundation.sql`
  - `supabase/migrations/20260423121000_072_project_workspace_access.sql`
  - `supabase/migrations/20260424110000_073_workspace_workflow_and_project_finalization.sql`
  - `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
  - `supabase/migrations/20260424150000_075_project_correction_re_release_foundation.sql`
  - `supabase/migrations/20260424170000_076_correction_consent_provenance.sql`
  - `supabase/migrations/20260425120000_078_media_library_folders_foundation.sql`
- Tenant and member management
  - `src/lib/tenant/permissions.ts`
  - `src/lib/tenant/active-tenant.ts`
  - `src/lib/tenant/resolve-tenant.ts`
  - `src/lib/tenant/member-management-service.ts`
  - `src/lib/tenant/member-management-route-utils.ts`
  - `src/lib/tenant/membership-invites.ts`
  - `src/lib/tenant/active-tenant-route-handler.ts`
  - `src/lib/tenant/tenant-cookies.ts`
  - `src/app/(protected)/members/page.tsx`
  - `src/components/members/member-management-panel.tsx`
  - `src/app/api/members/**`
  - `src/app/api/tenants/active/route.ts`
  - `src/app/select-tenant/page.tsx`
  - `src/app/join/[token]/page.tsx`
  - `src/app/join/[token]/accept/route.ts`
- Project, workspace, review, correction, and Media Library access
  - `src/lib/projects/project-workspaces-service.ts`
  - `src/lib/projects/project-workspace-request.ts`
  - `src/lib/projects/project-workflow-service.ts`
  - `src/lib/projects/project-workflow-route-handlers.ts`
  - `src/lib/profiles/profile-access.ts`
  - `src/lib/project-releases/project-release-service.ts`
  - `src/lib/project-releases/media-library-release-safety.ts`
  - `src/lib/media-library/media-library-folder-service.ts`
  - `src/lib/media-library/media-library-folder-route-handlers.ts`
  - `src/lib/assets/project-correction-asset-route-handlers.ts`
  - `src/app/api/projects/**`
  - `src/app/api/media-library/**`
  - `src/app/(protected)/projects/page.tsx`
  - `src/app/(protected)/projects/[projectId]/page.tsx`
  - `src/app/(protected)/media-library/page.tsx`
- Email foundation
  - `src/lib/email/outbound/jobs.ts`
  - `src/lib/email/outbound/types.ts`
  - `src/lib/email/outbound/renderers/tenant-membership-invite.ts`
  - `src/lib/email/outbound/tenant-membership-invite-delivery.ts`
- Tests
  - `tests/feature-070-tenant-rbac-foundation.test.ts`
  - `tests/feature-070-active-tenant-route.test.ts`
  - `tests/feature-073-project-workflow-foundation.test.ts`
  - `tests/feature-073-project-workflow-routes.test.ts`
  - `tests/feature-073-project-workflow-ui.test.tsx`
  - `tests/feature-074-project-release-media-library.test.ts`
  - `tests/feature-074-media-library-download.test.ts`
  - `tests/feature-075-project-correction-workflow.test.ts`
  - `tests/feature-076-correction-consent-intake-foundation.test.ts`
  - `tests/feature-076-correction-provenance-foundation.test.ts`
  - `tests/feature-077-media-library-release-helpers.test.ts`
  - `tests/feature-077-media-library-ui.test.ts`
  - `tests/feature-078-media-library-folder-routes.test.ts`
  - `tests/feature-078-media-library-folders.test.ts`
  - `tests/feature-078-media-library-ui.test.ts`
  - `tests/feature-079-correction-media-intake-foundation.test.ts`

Prior RPI docs were used as context only. Current live code and schema were treated as authoritative where they differ from earlier documents.

## Executive summary

Feature 070 and the follow-up 072-079 work already shipped a real fixed-role organization access model:

- fixed tenant roles: `owner`, `admin`, `reviewer`, `photographer`
- member-management UI and APIs
- tenant membership invite create/resend/revoke/accept flow
- cookie-backed active tenant switching
- workspace-scoped project visibility for photographers
- reviewer-capable review, finalize, correction, and Media Library access

The current gap is not "basic organization users." That exists already. The real missing layer is a stable, named capability model above the fixed roles. Today the system still duplicates role meaning in multiple TypeScript helpers and separate SQL helper functions. That duplication is manageable now, but it becomes the main blocker for future custom roles, richer access UI, and later project-scoped reviewer assignment.

Recommended bounded Feature 080:

- add a central code-level capability catalog for the existing fixed roles
- refactor app-layer permission helpers to derive from named capabilities instead of ad hoc booleans
- expose exact role capabilities in the current member-management area so access is clearer without changing actual behavior
- keep SQL/RLS behavior, fixed roles, invite flow, and project/workspace visibility behavior unchanged for this slice

Do not use Feature 080 to introduce custom-role schema, direct member-level overrides, or project-scoped reviewer assignments. Those all have materially larger blast radius and should be deferred to later RPI slices.

## Verified current Feature 070 implementation

### What Feature 070 already provides today

The current live implementation already includes all of the following:

- `memberships.role` supports `owner`, `admin`, `reviewer`, and `photographer`.
- `tenant_membership_invites` exists and supports `pending`, `accepted`, `revoked`, and `expired`.
- owner/admin-only member-management policies exist in SQL.
- owner/admin-only member-management APIs exist in `src/app/api/members/**`.
- `/members` exists and allows invite, resend, revoke, role change, and member removal.
- `/select-tenant` and `POST /api/tenants/active` implement active-tenant selection with a validated cookie.
- `/join/[token]` and `/join/[token]/accept` implement membership invite review and acceptance.
- typed outbound email delivery already includes `tenant_membership_invite`.
- project/workspace permissions already distinguish capture-oriented photographers from review-oriented reviewers.

### Tables, routes, helpers, and tests currently backing Feature 070

Core tables and functions:

- `public.memberships`
- `public.tenant_membership_invites`
- `app.current_user_membership_role(p_tenant_id)`
- `app.current_user_can_manage_members(p_tenant_id)`
- `app.current_user_can_create_projects(p_tenant_id)`
- `app.current_user_can_capture_project(p_tenant_id, p_project_id)`
- `app.current_user_can_review_project(p_tenant_id, p_project_id)`
- `public.ensure_tenant_for_current_user()`

Core TypeScript helpers:

- `resolveTenantPermissions(...)`
- `resolveProjectPermissions(...)`
- `resolveWorkspacePermissions(...)`
- `resolveAccessibleProjectWorkspaces(...)`
- `getTenantMemberManagementData(...)`
- `createTenantMemberInvite(...)`
- `resendTenantMemberInvite(...)`
- `revokeTenantMemberInvite(...)`
- `updateTenantMemberRole(...)`
- `removeTenantMember(...)`
- `listCurrentUserTenantMemberships(...)`
- `handleSetActiveTenantPost(...)`
- `acceptTenantMembershipInvite(...)`

Core routes and pages:

- `src/app/(protected)/members/page.tsx`
- `src/app/api/members/route.ts`
- `src/app/api/members/invites/route.ts`
- `src/app/api/members/invites/[inviteId]/resend/route.ts`
- `src/app/api/members/invites/[inviteId]/revoke/route.ts`
- `src/app/api/members/[userId]/route.ts`
- `src/app/select-tenant/page.tsx`
- `src/app/api/tenants/active/route.ts`
- `src/app/join/[token]/page.tsx`
- `src/app/join/[token]/accept/route.ts`

Tests already covering the foundation:

- fixed-role permission mapping and SQL helpers
- active tenant route behavior
- invite create-or-refresh and account reuse by email
- wrong-email invite acceptance rejection
- member-management listing
- non-owner role updates and member removal

### Current `/members` UI

Current `/members` is already a functioning organization-user management page for owner/admin users:

- invite form with role dropdown for `admin`, `reviewer`, `photographer`
- member table with:
  - email
  - role
  - joined timestamp
  - save role action
  - remove action
- pending invite table with:
  - email
  - role
  - expiry
  - resend action
  - revoke action

Owner rows remain visible but read-only:

- `canEdit` is `false` for `owner`
- owner role is displayed as text, not as an editable dropdown
- owner rows do not render remove buttons

Non-managers:

- do not see `/members` in the protected nav
- can still hit `/members` directly
- get a read-only notice instead of the management panel

### Current gaps relative to an advanced access environment

What is already done:

- basic organization user management
- invites
- active tenant switching
- non-owner role changes
- non-owner membership removal
- typed invite email delivery

What is still missing:

- named capability model
- exact capability display in UI
- custom roles
- project-scoped reviewer assignment
- richer photographer pool management surface
- owner transfer or owner demotion mechanics
- suspended/deactivated member states
- any access model more granular than fixed roles
- direct explanation in UI of what each role can actually do

## Current role and permission model

### Current roles

Current live roles are:

- `owner`
- `admin`
- `reviewer`
- `photographer`

Role storage:

- stored directly in `public.memberships.role`
- no separate `roles` table
- no `tenant_roles`
- no `tenant_role_permissions`
- no `membership_role_assignments`

Invites can only target non-owner roles:

- `admin`
- `reviewer`
- `photographer`

### Current TypeScript role mapping

`src/lib/tenant/permissions.ts` hardcodes the current meaning of each role.

Tenant-level booleans derived from role:

- `canManageMembers`
- `canManageTemplates`
- `canManageProfiles`
- `canCreateProjects`
- `canCaptureProjects`
- `canReviewProjects`

Current mapping:

- `owner`
  - yes: manage members, templates, profiles, create projects, capture, review
- `admin`
  - yes: manage members, templates, profiles, create projects, capture, review
- `reviewer`
  - yes: review
  - no: manage members, templates, profiles, create projects, capture
- `photographer`
  - yes: capture
  - no: manage members, templates, profiles, create projects, review

Project-level booleans derived from role:

- `canCreateOneOffInvites`
- `canCreateRecurringProjectConsentRequests`
- `canUploadAssets`
- `canInitiateConsentUpgradeRequests`

Those are still mapped indirectly from capture/review booleans, not from a first-class capability catalog.

### Current SQL helpers

Member and tenant-level:

- `app.current_user_membership_role(p_tenant_id)`
- `app.current_user_can_manage_members(p_tenant_id)`
- `app.current_user_can_create_projects(p_tenant_id)`

Project and workspace-level:

- `app.current_user_can_access_project(p_tenant_id, p_project_id)`
- `app.current_user_can_manage_project_workspaces(p_tenant_id, p_project_id)`
- `app.current_user_can_capture_project(p_tenant_id, p_project_id)`
- `app.current_user_can_review_project(p_tenant_id, p_project_id)`
- `app.current_user_can_access_project_workspace(p_tenant_id, p_project_id, p_workspace_id)`
- `app.current_user_can_capture_project_workspace(p_tenant_id, p_project_id, p_workspace_id)`
- `app.current_user_can_review_project_workspace(p_tenant_id, p_project_id, p_workspace_id)`

Media Library:

- `app.current_user_can_access_media_library(p_tenant_id)`
- `app.current_user_can_manage_media_library(p_tenant_id)`

Template and recurring-profile helpers from earlier features:

- `app.current_user_can_manage_templates(p_tenant_id)`
- `app.current_user_can_manage_recurring_profiles(p_tenant_id)`

### Where permissions are currently hardcoded or duplicated

The current system works, but the same access semantics are encoded in multiple places:

- SQL helper functions contain role lists.
- `deriveTenantPermissionsFromRole(...)` contains the same role lists again.
- `resolveProfilesAccess(...)` recomputes profile access separately.
- Media Library service uses `permissions.canReviewProjects` in TypeScript even though SQL also has dedicated Media Library helpers.
- project pages compute additional booleans such as `captureMutationsAllowed`, `reviewSafeMutationsAllowed`, and `correctionMediaIntakeAllowed` from a mixture of role booleans plus workflow state.
- `/projects` page duplicates photographer visibility logic by directly querying assigned workspaces.

This is the main current fragility. It is not a broken system, but it is the first thing that becomes expensive when introducing custom roles or reviewer assignments.

## Current member-management behavior

### Invite behavior

Owners/admins can invite members today:

- route: `POST /api/members/invites`
- service: `createTenantMemberInvite(...)`
- SQL RPC: `create_or_refresh_tenant_membership_invite(...)`

Current behavior:

- pending invite is unique per `(tenant_id, normalized_email)`
- creating another invite for the same pending target refreshes the existing row instead of creating a duplicate logical invite
- if the invited email already belongs to a user who is already a member, the RPC returns `already_member`
- resend can update the pending invite role and refresh token/expiry
- revoke marks pending invites revoked
- accept requires authenticated user email to match invite email

### Join and active tenant flow

Current join flow:

- public invite review page: `/join/[token]`
- sign-in/sign-up forms on that page carry `pending_org_invite_token`
- login/sign-up routes store `sc_pending_org_invite`
- protected layout redirects users with that cookie and no usable tenant context back to the join flow
- accepting the invite:
  - creates or reuses the membership
  - sets `sc_active_tenant` to the accepted tenant
  - clears `sc_pending_org_invite`

### Role changes and removal

Owners/admins can change non-owner roles today:

- route: `PATCH /api/members/[userId]`
- service: `updateTenantMemberRole(...)`
- target roles limited to `admin`, `reviewer`, `photographer`

Owners/admins can remove non-owner members today:

- route: `DELETE /api/members/[userId]`
- service: `removeTenantMember(...)`
- removal deletes only the `memberships` row
- auth account is preserved

Owner safety today:

- owner memberships cannot be edited
- owner memberships cannot be removed
- owner role is not inviteable

### Important current removal side effect

Removal does preserve the auth account, but current tenant bootstrap behavior matters:

- if a removed user still has another membership, they can switch to that tenant
- if a removed user has no memberships left, `ensure_tenant_for_current_user()` can auto-create a fresh owner tenant for that auth account on the next protected request

So the product already supports "remove from organization without deleting auth account," but the resulting user experience is "removed user may bootstrap a new solo tenant." That is an important current behavior to keep in mind for later features.

### Is the current UI/API already sufficient for basic organization user management?

Yes, for the narrow fixed-role model.

It already supports:

- invite
- resend
- revoke
- accept
- list members
- list pending invites
- change non-owner roles
- remove non-owner memberships

That means Feature 080 should not redo Feature 070 by rebuilding the basics. The genuinely new work is the layer above that fixed-role model.

## Photographer pool and staffing model

### How photographers are represented today

Photographers are not a separate organization entity. They are ordinary tenant members with:

- `memberships.role = 'photographer'`

The current "photographer pool" is implicit.

### Current staffing model after Feature 072

Project staffing is represented by `project_workspaces`:

- one default workspace per project
- optional photographer workspaces
- photographer workspace rows carry `photographer_user_id`
- unique index prevents multiple workspaces for the same photographer on the same project

Project staffing UI/API:

- `POST /api/projects/[projectId]/workspaces`
- `createPhotographerWorkspace(...)`
- project detail page queries all tenant memberships with `role = 'photographer'` and uses those as assignable photographers

There is no separate photographer directory table, no pool metadata, and no organization-level photographer management surface beyond the members page.

### What is missing

Missing from a fuller photographer pool environment:

- dedicated "photographer pool" list or filter
- staffing history
- pool-specific active/inactive states
- non-role metadata for photographers
- cross-project staffing overview

### Feature 080 recommendation for photographer pool scope

Defer photographer pool refinement.

Reasoning:

- the current live product already has a workable source of truth: photographer-role memberships
- project staffing exists already
- adding a dedicated pool model now would not help custom roles or reviewer assignments directly
- it would increase scope without reducing the main access-control duplication problem

## Reviewer access model

### Current reviewer visibility

Reviewers are currently tenant-wide reviewers, not project-scoped reviewers.

Current live behavior:

- reviewers can see all projects in the active tenant
- reviewers can access all project workspaces in the active tenant
- reviewers can perform review-capable project actions without needing explicit per-project assignment

This is enforced both in app code and in SQL:

- `app.current_user_can_access_project(...)` includes reviewers
- `app.current_user_can_access_project_workspace(...)` includes reviewers
- `app.current_user_can_review_project(...)` includes reviewers
- `app.current_user_can_review_project_workspace(...)` includes reviewers

### Current reviewer routes and surfaces

Read routes currently allowing reviewer access include:

- asset preview faces/links/candidates routes
- current and explicit face-review session reads
- Media Library list/detail/download reads
- project list and project detail reads

Review mutation routes currently allowing reviewer access include:

- face review session creation and item actions
- asset face assignment / hidden / blocked / manual face review routes
- whole-asset link routes
- correction consent intake routes
- project consent upgrade initiation
- workspace validation
- project finalize
- project correction start
- workspace correction reopen
- correction media intake

### Why project-scoped reviewer assignment is not a small first slice

Changing reviewers from tenant-wide to project- or workspace-scoped would require a new source of truth and a broad access sweep:

- new assignment table such as `project_reviewer_assignments`
- changes to project list visibility
- changes to `current_user_can_access_project`
- changes to `current_user_can_access_project_workspace`
- changes to `current_user_can_review_project`
- changes to `current_user_can_review_project_workspace`
- changes to many RLS policies generated in Feature 072 for review tables
- changes to route helpers and possibly to admin-client read models that assume reviewer access after a single helper check

That is a good future feature, but it is too large and too security-sensitive for the first post-070 access-management slice.

## Current tenant, project, and workspace permission boundaries

### Tenant-wide today

Tenant-wide owner/admin permissions:

- manage members
- manage templates
- manage recurring profiles
- create projects
- manage project staffing/workspaces

Tenant-wide reviewer visibility:

- all projects in active tenant
- all project workspaces in active tenant
- Media Library access
- Media Library folder management

Tenant-wide photographer visibility:

- only projects where the photographer has an assigned workspace

### Project-scoped today

Project-wide permission checkpoints:

- project creation is tenant-wide, not project-scoped
- project finalize uses review permission
- project correction start uses review permission

Reviewer access is still project-wide across the tenant once the user has reviewer role.

### Workspace-scoped today

Feature 072 made most operational tables workspace-scoped.

Capture-scoped writes use `app.current_user_can_capture_project_workspace(...)`:

- subject invites
- subjects
- consents inserts
- assets inserts and updates
- project profile participants inserts

Review-scoped writes use `app.current_user_can_review_project_workspace(...)`:

- asset consent links
- face review sessions
- face review session items
- project face assignees
- assignee link tables
- project consent upgrade requests
- many face-review-related tables created in earlier features

Workflow state then narrows those role grants further:

- capture mutations allowed only in `active` or `needs_changes`
- review mutations allowed only in `handed_off` or `needs_changes`
- correction review/consent/media helpers reopen some reviewer actions on finalized projects only when correction is open and the workspace was reopened for the current cycle

### Media Library today

Media Library is tenant-scoped.

Current behavior:

- access: owner/admin/reviewer
- folder management: owner/admin/reviewer
- photographers denied

This is enforced in SQL and mirrored again in app code.

## Capability catalog findings

### Would a central capability catalog be useful before custom roles?

Yes. This is the strongest bounded next step.

Why it helps now:

- removes duplication in app-layer role checks
- gives one stable vocabulary for current and future permissions
- lets `/members` explain what roles actually mean
- prepares later custom-role work without forcing schema/RLS changes yet

### Can current fixed roles map to named capabilities without schema change?

Yes.

Feature 080 can add a code-level catalog such as:

- `manage_members`
- `invite_members`
- `change_member_roles`
- `remove_members`
- `manage_templates`
- `manage_profiles`
- `create_projects`
- `manage_project_workspaces`
- `create_project_consents`
- `create_project_recurring_requests`
- `upload_project_assets`
- `review_workspace`
- `finalize_project`
- `start_project_correction`
- `reopen_workspace_for_correction`
- `perform_correction_review`
- `perform_correction_consent_intake`
- `perform_correction_media_intake`
- `access_media_library`
- `manage_media_library_folders`

Important finding:

The catalog must reflect real live behaviors, not only the future marketing list. The product already has separate capture, review, correction, and Media Library surfaces that need stable names.

### What a first-slice capability catalog should not try to do

Feature 080 should not:

- replace SQL RLS with capabilities
- add database capability rows
- add member-level overrides
- pretend custom roles exist already

For this slice, the catalog should be code-level and behavior-preserving.

## Custom role feasibility

### What custom roles would require

A credible custom-role system would likely need at least:

- `tenant_roles`
  - tenant-owned role definitions
  - name
  - slug
  - `is_system`
- `tenant_role_capabilities`
  - role-to-capability mapping
- `membership_role_assignments`
  - links membership to a system or custom role

Potential coexistence choices:

- keep `memberships.role` as the current system-role slug and add nullable custom-role linkage later
- or replace direct role usage with a role assignment table and keep system roles as seeded rows

### Why custom roles are too large for Feature 080 implementation

Current blocker:

- existing SQL helper functions and RLS policies directly read `memberships.role`
- many tables rely on those helpers
- a "schema only" custom-role foundation would create two partial sources of truth unless route and RLS migration happens with it

That makes Option D materially riskier than it first appears. It is not a harmless schema placeholder. It creates enforcement questions immediately.

### Owner bootstrap safety implications

Current owner safety is simple:

- bootstrap creates owner membership
- owner cannot be edited or removed

A future custom-role system must preserve:

- guaranteed bootstrap owner path
- at least one immutable high-authority system role
- protection against accidental owner downgrade or deletion

Those are later design constraints, not good first-slice work.

## Permission overrides feasibility

Direct member-level allow/disallow overrides should be deferred.

Reasons:

- they introduce precedence rules on top of roles
- tenant-wide and workspace-scoped overrides would be easy to misread
- direct overrides make security review harder than custom roles alone
- the product does not yet have a named capability base layer, so overrides would stack complexity on top of an already duplicated model

If exact exceptions are eventually needed, custom roles are easier to reason about than arbitrary per-user overrides.

## Options considered

### Option A - Advanced Organization Users UI only

Shape:

- improve `/members`
- better role descriptions
- maybe clearer labels and removal copy
- no new permission schema
- no shared capability catalog

Assessment:

- implementation size: small
- security risk: low
- route/RLS blast radius: minimal
- compatibility: excellent
- user value: moderate
- one-slice realism: high

Weakness:

- improves presentation, but does not reduce the actual role-logic duplication that blocks future custom roles

### Option B - Capability catalog foundation

Shape:

- keep fixed roles
- centralize current role-to-capability mapping in code
- refactor app helpers to consume that mapping
- update `/members` to show exact capabilities per role
- no custom role schema yet

Assessment:

- implementation size: small to medium
- security risk: low if behavior-preserving
- route/RLS blast radius: low because SQL can stay unchanged in this slice
- compatibility: excellent
- user value: moderate
- one-slice realism: high

Strength:

- best balance of foundation value and boundedness

### Option C - Project-scoped reviewer assignment foundation

Shape:

- add reviewer project assignments
- reduce reviewer visibility from tenant-wide to assigned projects/workspaces
- update project visibility and review permissions

Assessment:

- implementation size: medium to large
- security risk: high
- route/RLS blast radius: high
- compatibility: moderate
- user value: high
- one-slice realism: low

Reason it is too large:

- reviewer access is currently assumed across many project, workspace, review, correction, and RLS surfaces

### Option D - Custom role schema foundation

Shape:

- add custom-role tables
- keep system roles
- do not build full editor yet

Assessment:

- implementation size: medium
- security risk: medium to high
- route/RLS blast radius: medium immediately, high once enforcement follows
- compatibility: uncertain until enforcement rules are decided
- user value: low in first slice
- one-slice realism: low to medium

Main issue:

- schema without enforcement creates a half-finished second truth source

### Option E - Full custom roles and exact permission editor

Assessment:

- implementation size: large
- security risk: very high
- route/RLS blast radius: very high
- compatibility: complex
- user value: high eventually
- one-slice realism: no

This is explicitly out of bounds for Feature 080.

## Recommended bounded direction

Feature 080 should be Option B.

Recommended scope:

- add a single canonical capability catalog in TypeScript for the current fixed-role system
- refactor `src/lib/tenant/permissions.ts` and closely related app-layer helpers to derive from named capabilities
- keep current SQL helpers and RLS behavior unchanged for this slice
- update the current `/members` area so managers can see:
  - clearer role descriptions
  - exact capabilities each fixed role currently grants
  - existing invite/member actions with no behavior expansion
- explicitly document that removal preserves the auth account and only removes the tenant membership

This is the smallest safe next step because it:

- builds directly on Feature 070
- does not repeat the fixed-role foundation
- reduces duplication
- prepares later custom-role and scoped-reviewer work
- keeps server-authoritative tenant scoping intact

## What should be deferred to Feature 081+

- custom role schema
- custom role editor UI
- project-scoped reviewer assignment
- workspace-scoped reviewer assignment
- member-level permission overrides
- photographer pool redesign
- owner transfer/demotion workflow
- disabled/suspended member states
- per-folder, per-asset, or per-workspace custom overrides
- full SQL capability-based RLS migration

## Email and invite considerations

Current invite email behavior is already correctly centralized:

- typed job kind: `tenant_membership_invite`
- renderer: `src/lib/email/outbound/renderers/tenant-membership-invite.ts`
- delivery wrapper: `src/lib/email/outbound/tenant-membership-invite-delivery.ts`
- links use `buildTenantMembershipInvitePath(...)` plus the existing external-origin helper

Recommended Feature 080 outcome:

- no new email sending behavior required
- no SMTP/provider code should be added
- no invite delivery redesign should be attempted

If later access-management work changes invite semantics, it should continue to reuse this exact outbound-email foundation.

## UI and UX findings

### What `/members` should become

The current route can stay `/members` for continuity, but the area should be framed more clearly in UI chrome.

Recommended first-slice naming:

- page/nav label: `Organization users`
- route: keep `/members`

Why not `Access` yet:

- the product does not yet expose granular permissions or custom roles
- `Access` implies a richer permission console than currently exists

Why not keep `Members` as the primary label:

- the page also manages pending invites and role meaning
- `Organization users` better matches what the page already does

### First-slice UI content

Visible in the first slice:

- current members
- pending invites
- current role descriptions
- exact current capabilities for each fixed role
- clear copy that owner is immutable
- clear copy that removal only removes organization access, not the auth account

Do not add in this slice:

- complex permission matrix editor
- nested admin-console panels
- project-scoped assignment UI
- folder-level or asset-level access UI

## Security and reliability considerations

Non-negotiable boundaries that remain unchanged:

- access control stays server-authoritative
- `tenant_id` is never client-authoritative
- active tenant cookie must continue to be validated against server-side membership
- SQL/RLS remains the backstop for data access
- owner stays protected from accidental edit or removal

Specific current risks to account for:

- role meaning duplicated across app helpers and SQL helpers
- removed users with no other membership can bootstrap a new solo tenant because of current fallback behavior
- reviewer access is broad today, so any future attempt to scope it must be systematic
- Media Library app service currently checks `canReviewProjects`, which matches current SQL behavior but is still a duplicated decision

Reliability expectations for the recommended slice:

- no change to invite idempotency behavior
- no change to member mutation semantics
- no change to correction or workflow route authority
- no change to active-tenant recovery

## Risks and tradeoffs

Main tradeoff of the recommended slice:

- it improves the foundation and clarity, but it does not yet give the business new granular permissions

That is acceptable here because:

- project-scoped reviewer assignment is too large for a safe first slice
- custom-role schema without enforcement would be misleading
- the repo is better served by stabilizing permission vocabulary first

Main risk if Feature 080 skips the catalog step:

- future custom roles will have to untangle growing duplication across TypeScript helpers, UI conditions, and route assumptions all at once

## Test implications for the recommended slice

New tests to add for Option B:

- capability catalog mapping test for all fixed roles
- helper parity tests proving the capability catalog preserves current behavior for:
  - member management
  - template/profile management
  - project creation
  - workspace staffing
  - capture
  - review
  - finalize/correction
  - Media Library access
- `/members` UI tests or component tests covering:
  - owner read-only messaging
  - role capability display
  - removal-preserves-account explanatory copy if added

Regression coverage to keep green:

- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `tests/feature-070-active-tenant-route.test.ts`
- `tests/feature-073-project-workflow-foundation.test.ts`
- `tests/feature-073-project-workflow-routes.test.ts`
- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-074-media-library-download.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`
- `tests/feature-076-correction-consent-intake-foundation.test.ts`
- `tests/feature-078-media-library-folders.test.ts`
- `tests/feature-079-correction-media-intake-foundation.test.ts`

If plan phase widens the slice beyond pure catalog refactor:

- add focused route-helper parity tests before changing any access behavior

## Open decisions for plan phase

- final capability key names for the current fixed-role model
- whether `/members` page title and nav label should change to `Organization users` now or later
- whether capability descriptions appear inline in each row, in a role reference panel, or both
- whether Feature 080 should include minor `/members` copy improvements about invite/account-removal behavior
- whether the first slice should expose capabilities only in UI, or also add lightweight helper-return structures for future API responses

## Plan-phase recommendation

Plan Feature 080 as a behavior-preserving capability-catalog and access-clarity slice, not as a new enforcement model.

The next implementation should:

- centralize the current fixed-role semantics in one named capability catalog
- refactor app-layer permission helpers to consume that catalog
- keep SQL and RLS behavior stable
- improve the existing member-management area so role meaning is explicit

That is the smallest safe step that advances advanced organization access management without turning Feature 080 into an IAM rebuild.
