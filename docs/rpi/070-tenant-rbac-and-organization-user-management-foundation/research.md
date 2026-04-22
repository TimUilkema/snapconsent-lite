# Feature 070 Research - Tenant RBAC and organization user management foundation

## Inputs reviewed

Required inputs reviewed in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. Adjacent RPI docs:
   - `docs/rpi/002-projects-invites/*`
   - `docs/rpi/049-recurring-profiles-and-consent-management-foundations/*`
   - `docs/rpi/050-recurring-profile-directory-foundation/*`
   - `docs/rpi/055-project-participants-and-mixed-consent-intake/*`
   - `docs/rpi/060-tenant-resolution-hardening/*`
   - `docs/rpi/067-consent-scope-state-and-upgrade-requests/*`
   - `docs/rpi/068-outbound-email-foundation-with-local-emulation-and-typed-email-jobs/*`
   - `docs/rpi/069-consent-upgrade-flow-owner-reuse-and-prefill-refinement/*`

Live code, schema, routes, helpers, components, and tests inspected as source of truth:

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260304211000_002_projects_invites_rls.sql`
- `supabase/migrations/20260407150000_039_consent_form_template_editor.sql`
- `supabase/migrations/20260414170000_050_recurring_profile_directory_foundation.sql`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`
- `supabase/migrations/20260415210000_058_project_face_assignee_bridge.sql`
- `supabase/migrations/20260416090000_059_generic_face_assignee_suppressions.sql`
- `supabase/migrations/20260421110000_061_asset_assignee_links.sql`
- `supabase/migrations/20260422143000_067_consent_scope_state_foundations.sql`
- `supabase/migrations/20260422213000_068_outbound_email_foundation.sql`
- `supabase/migrations/20260422200000_069_upgrade_submit_binding_and_supersedence.sql`
- `src/lib/tenant/resolve-tenant.ts`
- `src/app/(protected)/layout.tsx`
- `src/app/auth/login/route.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/middleware.ts`
- `src/lib/supabase/admin.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/profiles/profile-access.ts`
- `src/lib/profiles/profile-directory-service.ts`
- `src/lib/profiles/profile-consent-service.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/lib/projects/project-consent-upgrade-route-handlers.ts`
- `src/lib/idempotency/invite-idempotency.ts`
- `src/lib/email/outbound/jobs.ts`
- `src/lib/email/outbound/registry.ts`
- `src/lib/email/outbound/types.ts`
- `src/lib/email/outbound/worker.ts`
- `src/lib/email/outbound/consent-receipt-delivery.ts`
- `src/lib/profiles/profile-follow-up-delivery.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/templates/**`
- `src/app/api/profiles/**`
- `src/app/api/projects/**`
- `tests/feature-039-consent-form-template-editor.test.ts`
- `tests/feature-050-recurring-profile-directory-foundation.test.ts`
- `tests/feature-051-baseline-recurring-consent-request-foundation.test.ts`
- `tests/feature-055-project-participants-foundation.test.ts`
- `tests/feature-060-tenant-resolution-hardening.test.ts`
- `tests/feature-068-outbound-email-foundation.test.ts`
- `tests/feature-068-outbound-email-foundation-db.test.ts`
- `tests/feature-069-upgrade-submit-foundation.test.ts`

Prior RPI docs were used as context only. The live code and current schema were treated as authoritative where they differed.

## Verified current behavior

### 1. Current live boundary

Auth and user model:

- Authentication is Supabase Auth email/password.
- The app does not have its own `users` table. App-side identity is `auth.users.id`.
- The only app-level user-to-organization relationship is `public.memberships`.

Tenant and membership model:

- `public.tenants` exists.
- `public.memberships` is keyed by `(tenant_id, user_id)`.
- Live role constraint is currently `owner`, `admin`, or `photographer`.
- The schema allows one account to have multiple memberships across multiple tenants.

Tenant resolution:

- `app.current_tenant_id()` picks the oldest membership by `created_at`, so current-tenant behavior is implicit rather than user-selected.
- `app.ensure_tenant_for_current_user()` auto-creates a tenant and `owner` membership when the authenticated user has none.
- `src/lib/tenant/resolve-tenant.ts` first calls `current_tenant_id()`, falls back to `ensure_tenant_for_current_user()`, then retries tenant lookup.
- Protected layout and many routes depend on this helper.

What this means in practice:

- Multi-tenant membership is partly supported in schema.
- Multi-org operation is not fully supported in the app.
- There is no active-tenant selector, no active-tenant preference model, and no organization switcher UI.
- Live resolution is still effectively single-active-tenant and bootstrap-first.

Current organization user management:

- There is no organization user list UI.
- There is no tenant-user invite table, route, helper, or component.
- There is no join-organization accept flow.
- `memberships` RLS currently only allows users to select their own rows, not manage other members.

Conclusion:

- Multi-tenant membership is partly supported, but organization user management is mostly absent.

### 2. Current authorization model

What is enforced today:

- Template management is restricted to `owner` and `admin`.
- Recurring profile management is restricted to `owner` and `admin`.
- Photographers can view recurring profiles but not manage them.

How those gates are implemented:

- DB helpers:
  - `app.current_user_can_manage_templates(p_tenant_id)`
  - `app.current_user_can_manage_recurring_profiles(p_tenant_id)`
- App helpers:
  - `resolveTemplateManagementAccess(...)`
  - `resolveProfilesAccess(...)`
- Tests verify photographers are blocked from template and recurring-profile writes.

What is not role-gated today:

- Most project creation and project workflow actions use tenant membership plus project scope, not role.
- `app.current_user_can_access_project(p_tenant_id, p_project_id)` checks membership/project access, not a finer permission boundary.
- Many project review and linking routes switch to `createAdminClient()` after checking authentication and tenant resolution.

Actions that currently assume any tenant member with project access can act:

- Create and revoke one-off invite links
- Add recurring profiles to projects
- Create project recurring consent requests
- Create one-off consent upgrade requests
- Upload and finalize project media
- Create and use review sessions
- Manually assign faces
- Create manual faces
- Block unmatched faces
- Hide or suppress faces
- Link and unlink assets and assignees

Current reviewer role status:

- There is no `reviewer` or `validator` role in live schema or code.
- Current post-handoff review behavior is effectively "any authenticated project member can do it."

## Current schema, routes, helpers, and UI surfaces involved

### Auth, tenant resolution, and memberships

- Schema:
  - `public.tenants`
  - `public.memberships`
  - `public.current_tenant_id()`
  - `public.ensure_tenant_for_current_user()`
- RLS:
  - `memberships_select_own`
- App code:
  - `src/lib/tenant/resolve-tenant.ts`
  - `src/app/(protected)/layout.tsx`
  - `src/app/auth/login/route.ts`
  - `src/lib/supabase/server.ts`
  - `src/lib/supabase/middleware.ts`

### Template management

- Schema and DB permissions:
  - `app.current_user_can_manage_templates(...)`
  - template editor/publish/archive migrations under Feature 039 through 046
- App code:
  - `src/lib/templates/template-service.ts`
  - `src/app/api/templates/route.ts`
  - `src/app/api/templates/[templateId]/route.ts`
  - `src/app/api/templates/[templateId]/publish/route.ts`
  - `src/app/api/templates/[templateId]/archive/route.ts`
  - `src/app/api/templates/[templateId]/versions/route.ts`
  - `src/app/api/projects/[projectId]/default-template/route.ts`
  - `src/app/(protected)/templates/page.tsx`
  - `src/app/(protected)/templates/[templateId]/page.tsx`

### Recurring profiles and recurring consent management

- Schema and DB permissions:
  - `app.current_user_can_manage_recurring_profiles(...)`
  - `recurring_profiles`
  - `recurring_profile_types`
  - `recurring_profile_consent_requests`
  - `recurring_profile_consents`
- App code:
  - `src/lib/profiles/profile-access.ts`
  - `src/lib/profiles/profile-directory-service.ts`
  - `src/lib/profiles/profile-consent-service.ts`
  - `src/lib/profiles/profile-follow-up-service.ts`
  - `src/lib/profiles/profile-headshot-service.ts`
  - `src/app/api/profiles/**`
  - `src/app/api/profile-types/**`

### Project creation, access, participants, review, and linking

- Core schema:
  - `projects`
  - `subjects`
  - `subject_invites`
  - `consents`
  - `project_profile_participants`
  - `project_face_assignees`
  - `project_consent_scope_signed_projections`
  - face review and linking tables from Features 031, 032, 045, 047, 048, 058, 059, 061, 067, and 069
- DB access helper:
  - `app.current_user_can_access_project(...)`
- App code:
  - `src/app/api/projects/route.ts`
  - `src/app/api/projects/[projectId]/invites/**`
  - `src/app/api/projects/[projectId]/profile-participants/**`
  - `src/app/api/projects/[projectId]/assets/**`
  - `src/app/api/projects/[projectId]/consents/**`
  - `src/lib/projects/project-participants-service.ts`
  - `src/lib/projects/project-consent-upgrade-service.ts`
  - `src/lib/matching/**`
  - `src/app/(protected)/projects/[projectId]/page.tsx`
  - `src/components/projects/project-participants-panel.tsx`
  - `src/components/projects/one-off-consent-upgrade-form.tsx`

### Invite flows

- One-off project invite flow:
  - `src/lib/idempotency/invite-idempotency.ts`
  - `src/app/api/projects/[projectId]/invites/route.ts`
  - `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`
  - `src/app/i/[token]/page.tsx`
  - `src/app/i/[token]/consent/route.ts`
- Recurring project/baseline consent flows:
  - `src/app/rp/[token]/page.tsx`
  - `src/app/rp/[token]/consent/route.ts`
  - `src/app/rr/[token]/revoke/route.ts`

### Outbound email foundation that should be reused

- Schema:
  - `public.outbound_email_jobs`
  - enqueue/claim/complete/fail/cancel RPCs from Feature 068
- App code:
  - `src/lib/email/outbound/jobs.ts`
  - `src/lib/email/outbound/registry.ts`
  - `src/lib/email/outbound/types.ts`
  - `src/lib/email/outbound/worker.ts`
  - `src/app/api/internal/email/worker/route.ts`

Live reuse boundary:

- The foundation is real and production-shaped.
- Typed outbound email kinds currently include only `consent_receipt`.
- One-off consent receipts already use the foundation, but recurring receipt delivery and follow-up delivery still do not fully use it.
- Feature 070 should extend this foundation for organization invites, not introduce a separate SMTP path.

## Current constraints and invariants

- Tenant scoping is the core security boundary and must remain server-derived.
- Client-provided `tenant_id` cannot become authoritative.
- Membership is tenant-scoped and user-scoped; there is no app-local duplicate-account concept.
- Existing template and recurring-profile permission checks already treat admin-like roles as tenant-wide managers.
- Project review and linking architecture is already built around project access plus assignee/linking state. Feature 070 should not redesign that data model.
- One-off and recurring identities are currently separate by design:
  - one-off subjects are project-scoped
  - recurring profiles are tenant-scoped
  - assignees distinguish `project_consent` vs `project_recurring_consent`
  - scope projections distinguish `owner_kind = 'one_off_subject'` vs `owner_kind = 'project_participant'`
- Existing auto-bootstrap behavior can create a new owner tenant for authenticated users with no membership. That is compatible with solo onboarding, but risky for future invite acceptance and multi-org onboarding.

## Role and membership model options considered

### Option A - Fixed small role set

Description:

- Keep a single `memberships.role` value.
- Add only the roles needed for the next bounded slice.
- Enforce permissions through server-side role helpers and DB predicates.

Pros:

- Fits the current schema.
- Smallest migration surface.
- Easy to audit and test.
- Matches current repo style.

Cons:

- Less flexible than a long-term capability system.
- Some later exceptions may require additional role helper logic.

### Option B - Capability flags only

Description:

- Replace role-centric logic with explicit per-capability grants.

Pros:

- Maximum long-term flexibility.

Cons:

- Overdesigned for the repo's current maturity.
- Larger schema, UX, and test surface.
- Harder to reason about in a first RBAC slice.

### Option C - Role plus capability layering from day one

Description:

- Keep roles, but also add override capabilities now.

Pros:

- Future-proof.

Cons:

- Still materially larger than current needs.
- Introduces plan and UX complexity before the base role model is proven.

### Recommended first-slice role model

Use Option A now.

Recommended bounded first-slice roles:

- `owner`
- `admin`
- `reviewer`
- `photographer`

Reasoning:

- `owner` already exists and is part of tenant bootstrap. Removing it in the same feature would expand scope.
- `admin` should remain the broad tenant manager role.
- `reviewer` is needed because current review/validation responsibilities are distinct from field capture.
- `photographer` already exists and is the correct constrained field role.

Recommended interpretation:

- `owner` and `admin` are tenant-wide managers for user management, templates, recurring profiles, and photographer pool management.
- `reviewer` can access project review and validation workflows but not tenant-wide management.
- `photographer` can capture/upload/handoff, but not review governance or tenant-wide management.

Recommended implementation style:

- Keep one role column now.
- Build explicit server-side permission helpers on top of roles.
- Do not introduce a separate capability table in Feature 070.

## Invite and account-reuse options considered

### Required product rule confirmed

The requested product rule fits the live auth model:

- invites are always sent to an email address
- the same email may later attach to an existing auth account
- different emails must remain separate accounts for this feature
- the system must not infer identity across different email addresses

### Behavior options

#### Option A - Always create a fresh user record per invite

- Not compatible with Supabase Auth as used here.
- Would create duplicate accounts and break multi-org membership reuse.

#### Option B - Email-based membership reuse

- Invite is addressed to normalized email.
- If the accepting authenticated user has the same email, create or activate membership in the target tenant.
- If the email does not yet belong to an auth account, complete signup/login first, then create membership for that new account.

This is the correct bounded behavior.

### Recommended invite outcomes

New email, new account:

- Create a pending organization invite for the email.
- Send an invite email through the outbound email foundation.
- On signup/login with the same email, accept the invite and create membership.

Existing email, existing account:

- Create a pending organization invite for that email.
- On acceptance by the existing account, create membership in the new tenant instead of creating a duplicate account.

Duplicate pending invite for same tenant and email:

- Reuse or refresh the existing pending invite instead of creating a second logically identical invite.
- Allow resend semantics through the email job system without multiplying memberships.

Already-member invite:

- Do not create another membership row.
- Return an idempotent "already a member" result and optionally allow a resend or a no-op depending on UX choice.

Recommended reliability patterns:

- Unique logical pending-invite constraint per `(tenant_id, normalized_email)` for active pending states.
- Idempotency keys for invite creation and resend actions.
- Acceptance path must be transactionally safe:
  - verify invite still pending
  - verify accepting account email matches invite email
  - upsert membership
  - mark invite accepted or already-satisfied
- Retry-safe behavior should return the resolved membership/invite outcome, not duplicate rows.

## Photographer pool, tenant membership, and project access analysis

Current live model already separates three concepts:

- tenant membership: `memberships`
- recurring people directory / photographer pool analog: `recurring_profiles`
- project-specific access and assignee state: `projects`, `project_profile_participants`, `project_face_assignees`

Recommended bounded distinction:

- Tenant membership should remain the organization relationship.
- Project access should remain an additive project/workflow concern on top of membership, not a replacement for membership.
- Photographer pool should not become a separate organization relationship in Feature 070.

Why photographers should remain normal tenant members:

- The repo already uses membership as the main tenant authority boundary.
- Templates, profiles, project routes, and review routes all resolve tenant first.
- Introducing a second org relationship just for photographers would complicate RLS, active-tenant logic, and invite acceptance with little immediate benefit.

Recommended model:

- Photographers are normal tenant members with a constrained role.
- Reviewer access is also a normal tenant membership role.
- Project assignment, project visibility, and later workflow assignment can stay additive and be refined in follow-up features.

## Photographer and reviewer workflow boundary analysis

### Current live workflow boundary

Current code has rich review/linking actions, but not a formal project lifecycle state machine.

Observed live workflow shape:

1. Project exists and is active.
2. Staff create one-off invites and recurring participant requests.
3. Assets are uploaded and finalized.
4. Review/linking/manual face actions happen inside the same active project.
5. Project status remains `active` unless archived.

There is no first-class project state for:

- capture
- handoff
- in review
- validated
- complete

### Recommended Feature 070 boundary

Feature 070 should define permission boundaries for the current workflow surfaces, not invent new workflow states.

Feature 070 should cover:

- organization membership and invite foundation
- tenant roles
- server-side permission gates for:
  - template management
  - recurring profile management
  - project capture/upload actions
  - project review/validation actions

Feature 070 should not cover:

- project handoff state machine
- full validated/completed project status design
- media library or DAM lifecycle
- broader review-system redesign

Recommended current-stage split:

- `photographer`: capture consents, upload media, finalize/handoff current upload work
- `reviewer`: review assets and consent data, correct links, add manual faces, suppress or block faces, run upgrade requests, mark validation completion in a later feature
- `admin` and `owner`: all of the above plus tenant management

## One-off vs recurring identity implications

### What happens today

The same real person can exist both as:

- a project-scoped one-off subject in `subjects`
- a tenant-scoped recurring profile in `recurring_profiles`

Live code does not auto-merge them.

The architecture explicitly keeps them separate:

- one-off assignees use `assignee_kind = 'project_consent'`
- recurring assignees use `assignee_kind = 'project_recurring_consent'`
- scope projections use different owner kinds
- project UI shows recurring participants and one-off invite/consent cards in separate sections

### Implications

Assignees and matching:

- The same person can appear through different assignee families.
- This is already accounted for structurally because one-off and recurring assignees are distinct.

Review and operations:

- Operators can see the same real-world person represented in different ways.
- That can be confusing, but it is safer than silent auto-merging.

Reporting:

- Reporting that counts people may overcount real-world humans if it treats one-off and recurring rows as the same concept.
- That is already a product semantics issue, not a Feature 070-specific regression.

Recommendation:

- Keep one-off and recurring identities separate in Feature 070.
- Do not auto-convert a one-off subject into a recurring profile.
- Do not infer identity across the two models, even when emails match.

This is consistent with the live code and is the safer bounded choice.

## Agency compatibility considerations

Feature 070 should stay tenant-first and avoid introducing concepts that make future agency hierarchies harder.

Compatibility constraints to preserve now:

- Keep membership attached to a tenant, not to a global agency graph.
- Keep invite acceptance scoped to one tenant membership at a time.
- Avoid hard-coding assumptions that one account can only ever have one tenant.
- Avoid embedding role semantics into route paths or UI structure in ways that assume a flat single-company future forever.
- Keep permission helpers explicit and composable so a future parent-child org model can map onto them.

Choices that would make future agency/customer relationships harder:

- Treating tenant membership as globally unique per account
- Requiring one permanent tenant as the only home org
- Mixing project assignment state into membership rows
- Designing invite acceptance around one-time account ownership instead of reusable memberships

## Security and reliability findings

Key security gap:

- Many project review and linking routes use the service-role client after only authentication and tenant resolution checks.
- Feature 070 will need stronger server-side permission helpers before those routes can safely distinguish photographer vs reviewer vs admin.

Likely required changes:

- Expand membership role constraint to include `reviewer`.
- Add server-side permission helpers for project capture vs project review actions.
- Add tenant-member listing and membership mutation paths that stay server-controlled.
- Add invite storage and acceptance logic with tenant-scoped uniqueness and transactional membership upsert behavior.
- Review RLS and RPC boundaries so organization membership management remains server-authoritative.

Active-tenant behavior for multi-org users:

- Current oldest-membership resolution is not sufficient once users belong to multiple organizations intentionally.
- Feature 070 should at minimum introduce an active-tenant concept that is server-validated against memberships.
- Minimal acceptable behavior:
  - if a user has exactly one membership, resolve it automatically
  - if a user has multiple memberships, require an explicit active-tenant choice
  - never trust a raw client tenant id without validating membership

Invite/onboarding reliability cases that must be handled:

- duplicate invite submit
- resend against an existing pending invite
- accepting after membership already exists
- accepting after invite revoked or expired
- accepting while logged into an account with a different email
- retries during acceptance after membership insert but before invite status update
- stale invite after role changed or invite superseded
- bootstrap conflict where a just-invited user with no memberships should not accidentally auto-create a separate owner tenant first

Email reuse requirement:

- Invite emails should be sent through the Feature 068 outbound email foundation.
- Feature 070 should add new typed email job kinds and renderer/registry entries rather than bypassing the queue.

## Recommended bounded direction

### Best bounded architecture for Feature 070

1. Keep `memberships` as the core tenant relationship.
2. Preserve existing `owner` for bootstrap compatibility and add `reviewer` alongside `admin` and `photographer`.
3. Build a small fixed-role permission matrix in server-side helpers and use it consistently in routes/services.
4. Add organization invite and membership-management foundation using tenant-scoped pending invites addressed by email.
5. Reuse the outbound email foundation for invite delivery.
6. Add a server-validated active-tenant concept for users with more than one membership.
7. Add explicit role enforcement to project capture and project review routes, especially the ones that currently elevate to service role.

### What should be in the first slice

- List tenant members for admins/owners
- Invite user by email into tenant
- Accept invite into existing account or newly created account with matching email
- Idempotent handling for duplicate invite / already-member / retry cases
- Change membership role for allowed roles
- Remove or deactivate tenant membership
- Role enforcement for:
  - template management
  - recurring profile management
  - project capture/upload actions
  - project review/validation actions
- Minimal active-tenant handling for multi-org users

### What should be deferred

- Enterprise IAM or capability editor
- SSO
- billing
- advanced audit console
- agency/client hierarchy
- project lifecycle state machine for capture to handoff to validation completion
- DAM/media library/export redesign
- identity merging between one-off subjects and recurring profiles

## Risks and tradeoffs

- Keeping `owner` for now avoids a bigger migration, but means the first role model still has four roles instead of the cleaner three-role product language.
- Adding `reviewer` without a project-state redesign means permissions will be action-based before they are workflow-state-based.
- Active-tenant support is required for correctness, but a full org switcher experience may be larger than the rest of the feature if not kept minimal.
- Invite acceptance must be carefully designed around the existing auto-bootstrap behavior or invited users may accidentally create new owner tenants before joining the target organization.
- Strengthening route permissions may expose places where current UI assumes any member can act; some UX updates will likely be required in the plan phase.

## Explicit open decisions for the plan phase

- Keep `owner` as a distinct role in Feature 070, or collapse it into `admin` later while preserving bootstrap behavior?
- What is the minimum active-tenant implementation that is safe enough for multi-org users without expanding into a full account-settings feature?
- Should membership removal be hard delete, soft delete, or status-based for the first slice?
- Should invite acceptance be one-click from email after auth, or a protected "join organization" confirmation flow?
- What exact permission matrix applies to:
  - creating one-off invites
  - creating recurring project consent requests
  - uploading and finalizing assets
  - manual linking, suppressions, hidden faces, blocked faces, and review sessions
  - initiating consent upgrade requests
- Should reviewers be allowed to create upgrade requests from day one, or should that remain admin-only in the first slice?
- What is the minimal UI surface for organization user management in this repo:
  - settings page
  - tenant members page
  - project page entry point
- How should pending invites behave when the same email is reinvited with a different role?
- How should org-invite onboarding interact with current auto-bootstrap so invited users do not fork themselves into unintended personal tenants?
