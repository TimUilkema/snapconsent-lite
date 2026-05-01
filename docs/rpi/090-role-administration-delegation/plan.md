# Feature 090 Plan - Role administration delegation decision and future-scope plan

## 1. Scope and contract

Feature 090 is a decision and planning artifact only. It does not implement role administration delegation and must not change runtime behavior.

In scope:

- Document the role-administration delegation risks found during research.
- Document the future permission vocabulary for custom role administration and reviewer access administration.
- Document the safest future split between custom role assignment, custom role editor delegation, and reviewer access delegation.
- Recommend next feature sequencing.
- Preserve the current Feature 089 boundary.

Out of scope:

- Code changes.
- Migrations.
- UI changes.
- Test changes.
- Capability catalog changes.
- SQL seed changes.
- i18n/message changes.
- Route or service changes.
- Custom role editor delegation.
- Custom role assignment delegation.
- Reviewer access delegation.
- A generic effective permission engine.

Feature 090 must not add any of these capability keys:

- `custom_roles.manage`
- `custom_roles.assign`
- `reviewer_access.manage`
- `roles.manage`
- `roles.assign`

Feature 090 must not update the capability catalog, SQL seeds, labels, routes, services, UI, or tests.

## 2. Inputs and ground truth

Primary inputs reviewed:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/090-role-administration-delegation/research.md`

Targeted live verification reviewed:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/tenant-custom-role-capabilities.ts`
- `src/lib/tenant/custom-role-service.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/organization-user-access.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/components/members/custom-role-management-section.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/components/members/delegated-member-management-panel.tsx`
- `src/components/projects/project-reviewer-access-panel.tsx`
- Feature 082, 083, 088, and 089 migrations relevant to reviewer access, custom role editor RPCs, and delegated organization-user helpers.
- Feature 082, 083, 084, 088, and 089 test files were identified as the relevant future regression surfaces.

Live code and migrations through Feature 089 are authoritative. Prior RPI documents and `SUMMARY.md` are useful orientation, but they are not a substitute for the verified live boundary.

## 3. Verified current boundary

### Custom role editor

Current live behavior remains fixed owner/admin only:

- `listRoleEditorData`, `createTenantCustomRole`, `updateTenantCustomRole`, and `archiveTenantCustomRole` call a fixed member-management gate.
- That gate relies on `resolveTenantPermissions(...).canManageMembers`, which is fixed owner/admin authority.
- Delegated organization-user capabilities do not grant role editor access.
- System roles are exposed as immutable editor reference data, not editable custom roles.
- Custom roles can be archived.
- Archived custom roles cannot be edited as active role definitions.
- Capability sets are validated against the TypeScript catalog and the SQL capability catalog before write RPCs are called.
- Feature 083 SQL RPCs hard-check owner/admin membership and are executable by `service_role`, not by direct authenticated client writes.

### Custom role assignment

Current live behavior remains fixed owner/admin only:

- Custom role assignment listing, assignment, and revocation call the same fixed member-management gate.
- Delegated organization-user capabilities do not grant custom role assignment access.
- Only tenant-scope custom role assignments are used by the current member-management assignment workflow.
- System roles cannot be assigned or revoked through the custom role assignment workflow.
- Archived custom roles cannot be newly assigned.
- Archived assigned roles can be revoked because revocation must remain possible after archive.
- Duplicate active assignment is handled idempotently by returning the existing assignment.
- Revocation is represented by `revoked_at` and `revoked_by`; revoked assignments do not grant enforced permissions.
- Member removal cascades or cleanup paths prevent active stale authority from removed members.

### Reviewer access assignment

Current live behavior remains fixed owner/admin only:

- Tenant-wide reviewer access grant/revoke is fixed owner/admin only.
- Project reviewer access grant/revoke is fixed owner/admin only.
- Reviewer access uses role assignment rows for the system reviewer role definition, not tenant custom role definitions.
- Reviewer access targets must be fixed `reviewer` members.
- Tenant-wide reviewer access and project reviewer access are separate assignment scopes.
- Reviewer access cleanup runs when a reviewer member is changed away from reviewer or removed.

### Enforced tenant custom-role capability allowlist

After Feature 089, tenant-scoped custom role enforcement is limited to:

- `media_library.access`
- `media_library.manage_folders`
- `templates.manage`
- `profiles.view`
- `profiles.manage`
- `projects.create`
- `project_workspaces.manage`
- `organization_users.manage`
- `organization_users.invite`
- `organization_users.change_roles`
- `organization_users.remove`

Project-scoped and workspace-scoped custom-role assignments are still not generally enforced. Feature 090 must not expand enforcement scope.

### Delegated organization-user boundary

Features 088 and 089 delegate bounded organization-user actions only:

- delegated read/list
- delegated invites
- delegated fixed role changes for reviewer/photographer targets
- delegated member removal for reviewer/photographer targets

Those capabilities do not grant:

- role editor access
- custom role assignment access
- reviewer access grant/revoke
- owner/admin target authority
- self-management authority

### Absent capability keys

The live TypeScript capability catalog does not include:

- `custom_roles.manage`
- `custom_roles.assign`
- `reviewer_access.manage`
- `roles.manage`
- `roles.assign`

Feature 090 keeps that absence intact.

## 4. Decision: no implementation in Feature 090

Feature 090 defers implementation because role administration is a privilege-escalation boundary, not a simple extension of organization-user row management.

Implementation is deferred for these reasons:

- Role editor delegation can allow self-escalation if a delegated user can edit a role assigned to themselves.
- Role assignment delegation can allow self-escalation if a delegated user can assign a powerful role to themselves.
- Creating arbitrary custom roles plus assignment authority is equivalent to creating new permissions.
- Assigning roles with capabilities the actor does not personally have can escalate other users beyond the actor.
- Assigning role-administration capabilities creates recursive delegation paths.
- Reviewer access delegation can grant broad project or tenant-wide review authority through the system reviewer assignment model.
- The app does not currently have a generic effective capability ceiling that can safely answer "actor may grant only what actor already has" across fixed roles, tenant custom roles, project scopes, and workspace scopes.
- Project-scoped and workspace-scoped custom role semantics are not ready for a general delegated role assignment UI.
- Delegated-safe role editor RPCs do not exist.
- A reduced role editor UI that hides or disables high-risk capabilities does not exist.
- A reduced role assignment UI with target and role filtering does not exist.
- High-risk capability filtering is unresolved and should be decided before runtime behavior changes.

The decision for Feature 090 is therefore: document the future model, preserve the current fixed owner/admin boundary, and make no code changes.

## 5. Future capability naming recommendation

For future features, use these names:

- `custom_roles.manage`
- `custom_roles.assign`
- `reviewer_access.manage`

Do not use `roles.manage` or `roles.assign` for this product boundary.

Rationale:

- `roles.*` sounds broader than intended and could imply fixed/system role administration.
- System roles remain immutable and should not be part of delegated custom role administration.
- `custom_roles.*` is explicit that the capability applies to tenant custom role definitions and tenant custom role assignments.
- `reviewer_access.manage` must remain separate because reviewer access uses the system reviewer role assignment model, not tenant custom role assignment.
- `organization_users.manage`, `organization_users.change_roles`, and `organization_users.remove` must not be overloaded for role administration.

Future fixed role mapping should default to owner/admin receiving the new capabilities and reviewer/photographer receiving none by default. That mapping should be implemented only in the later feature that actually enforces the new capability.

## 6. Future implementation split

Recommended future split:

1. Feature 091 - Custom role assignment delegation.
2. Feature 092 - Custom role editor delegation research.
3. Feature 093 - Reviewer access delegation research.

The feature numbers can shift if the roadmap changes, but the split should remain. Custom role assignment, custom role definition management, and reviewer access administration should not be bundled into one implementation feature.

## 7. Recommended Feature 091 scope

Feature 091 should be the first implementation candidate and should focus on `custom_roles.assign`, not `custom_roles.manage`.

Recommended Feature 091 first-slice constraints:

- Tenant-scope custom role assignments only.
- No project-scoped custom role assignment.
- No workspace-scoped custom role assignment.
- Target users limited to fixed `reviewer` and `photographer`.
- No owner targets.
- No admin targets.
- No self-assignment.
- No assigning roles that contain role-administration capabilities.
- No assigning roles outside an explicit allowed capability subset.
- No assigning archived roles.
- No assigning system roles through this workflow.
- Fixed owner/admin retain full assignment authority.
- Delegated assignment checks must be separate from the existing owner/admin full-authority path.
- Delegated revocation should follow the same target and role restrictions as delegated assignment.
- Delegated users should not revoke owner/admin custom role assignments.
- Delegated users should not see privileged assignment data that they cannot act on unless a future plan explicitly justifies read-only exposure.

Feature 091 should prefer an explicit low-risk allowed capability subset over an actor-effective-capability ceiling unless the plan first introduces a reliable cross-scope effective permission engine.

## 8. Future `custom_roles.manage` rules

`custom_roles.manage` should come later than delegated assignment. It is higher risk because editing one role definition can change permissions for every active assignee.

Recommended future constraints:

- No system role management.
- No editing roles assigned to the actor.
- No archiving roles assigned to the actor.
- No role-administration capabilities in delegated-managed roles.
- Strict capability allowlist for delegated-managed role definitions.
- No arbitrary capability selection by delegated users.
- No editing archived roles through delegated workflows.
- No managing roles with high-risk capabilities unless fixed owner/admin.
- Reduced role editor UI, not the current full owner/admin editor.
- Delegated-safe SQL/RPC path separate from the full owner/admin role editor if the current RPCs remain owner/admin hard-checked.
- Direct authenticated writes remain disabled.
- Server routes/services must perform explicit delegated authorization before service-role writes.

The current `CustomRoleManagementSection` is a full editor. A future delegated editor likely needs a reduced component or a strongly filtered data model so users cannot see or select capabilities outside their allowed subset.

## 9. Future `custom_roles.assign` rules

`custom_roles.assign` should apply only to tenant custom role assignment in the first implementation slice.

Recommended future constraints:

- The actor must have `custom_roles.assign` through an active tenant-scoped assignment or fixed owner/admin authority.
- Delegated assignment must reject self-assignment.
- Delegated assignment must reject owner/admin targets.
- Delegated assignment must initially allow reviewer/photographer targets only.
- Delegated assignment must reject system roles.
- Delegated assignment must reject archived roles.
- Delegated assignment must reject roles containing `custom_roles.manage`, `custom_roles.assign`, or `reviewer_access.manage`.
- Delegated assignment must reject roles containing capabilities outside the explicit allowed subset.
- Delegated revocation must be idempotent.
- Duplicate active assignment must remain idempotent.
- Revoked assignments must remain ignored by enforcement.
- Cross-tenant role IDs and target users must be rejected.

The existing full Members page custom role assignment controls should not be reused unchanged for delegated users. A future delegated UI needs filtered target rows, filtered assignable role options, and copy explaining that only approved custom roles can be assigned to reviewer/photographer members.

## 10. Future `reviewer_access.manage` rules

`reviewer_access.manage` should be separate from custom role assignment.

Recommended future constraints:

- Do not bundle reviewer access delegation with `custom_roles.assign`.
- Project reviewer access delegation may be safer than tenant-wide reviewer access delegation.
- Tenant-wide reviewer access should remain fixed owner/admin unless a future feature explicitly justifies it.
- Target members must remain fixed `reviewer`.
- Project tenant scoping must be enforced before grant/revoke.
- Project reviewer access must not grant tenant-wide Media Library or tenant-wide review authority.
- Direct authenticated writes remain disabled.
- Server routes/services must perform explicit delegated authorization before service-role writes.

Reviewer access is special because it grants review reach through the system reviewer role assignment model. It should not be treated as just another custom role assignment.

## 11. Escalation risk model

Escalation paths to preserve in future plans and tests:

- Editing a self-assigned role can add capabilities to the actor.
- Assigning a role to self can immediately grant new capabilities.
- Creating arbitrary powerful custom roles and then assigning them is equivalent to granting arbitrary permissions.
- Assigning roles with capabilities the actor does not have can escalate other users beyond the actor.
- Assigning role-administration capabilities can create recursive administration paths.
- Two delegated users could mutually assign roles back and forth unless target, role, and self-management rules block the path.
- Archiving a role assigned to many users can disrupt broad access.
- Editing a role assigned to many users can unexpectedly change permissions for many members at once.
- Granting tenant-wide reviewer access can grant broad review authority across projects.
- Granting project reviewer access can expose project data beyond the intended review group.
- Allowing delegated users to target owners/admins can undermine the fixed-role hierarchy.

High-risk capabilities should be fixed owner/admin-only by default until a later plan explicitly proves a narrower safe rule:

- `custom_roles.manage`
- `custom_roles.assign`
- `reviewer_access.manage`
- `organization_users.change_roles`
- `organization_users.remove`
- `organization_users.invite` when used for admin invitations
- `projects.create`
- `project_workspaces.manage`
- workflow/finalization and correction capabilities once they are enforced

## 12. Non-expansion boundaries

Feature 090 does not grant or alter:

- member management
- organization invites
- fixed role changes
- member removal
- custom role editor
- custom role assignment
- reviewer access grant/revoke
- project creation
- project workspace management
- capture/upload
- review
- workflow/finalization
- correction
- Media Library
- templates/profiles
- project-scoped custom-role enforcement
- workspace-scoped custom-role enforcement
- generic effective permission engine
- owner transfer/demotion
- member-level deny/override rules
- agency/client hierarchy

Feature 090 also does not alter the current owner/admin-only behavior for:

- custom role definition create/edit/archive
- tenant custom role assignment/revocation
- tenant-wide reviewer access grant/revoke
- project reviewer access grant/revoke

## 13. Future test guidance

Feature 090 adds no tests because it changes no runtime behavior.

Future Feature 091+ tests should cover:

- no self-assignment
- no owner/admin targets
- no archived role assignment
- no system role assignment
- no cross-tenant assignment
- no role-admin capability assignment
- no role outside allowed subset
- revoked assignments ignored
- duplicate assignment idempotency
- revocation idempotency
- archived assigned role revocation remains possible
- reduced UI data does not leak privileged role metadata
- delegated users do not see owner/admin assignment controls
- delegated users do not see role editor controls unless a later feature adds a reduced editor
- SQL/RLS and TypeScript parity
- service-role writes are protected by server-side authorization
- fixed owner/admin full-authority behavior remains intact

Future `custom_roles.manage` tests should additionally cover:

- no editing roles assigned to self
- no archiving roles assigned to self
- no delegated management of system roles
- no delegated management of high-risk capability sets
- SQL RPC behavior for delegated-safe paths versus owner/admin full paths

Future `reviewer_access.manage` tests should additionally cover:

- no tenant-wide reviewer access delegation unless explicitly in scope
- project tenant scoping
- reviewer-only targets
- no grant to admin/owner/photographer targets
- project access does not imply tenant-wide access

## 14. Fresh reset/dev data note

For future implementation features, local development can assume `supabase db reset`.

Future tests should create their own tenants, fixed-role members, custom role definitions, capability mappings, active assignments, revoked assignments, archived roles, cross-tenant fixtures, project/workspace scoped rows, reviewer access assignments, and UI data fixtures. Do not preserve, repair, backfill, or normalize arbitrary old local role rows unless a future feature identifies a production migration requirement.

## 15. Plan-phase open decisions for later features

Open decisions for Feature 091:

- Exact explicit allowed capability subset for delegated custom role assignment.
- Whether delegated users may revoke roles they did not assign.
- Whether delegated users may see filtered read-only assignment data for non-targetable users.
- Whether assignment should require the delegated actor to personally have every assigned capability, or whether an explicit allowlist is sufficient for the first slice.
- Exact TypeScript helper shape for delegated custom role assignment checks.
- Whether SQL needs a delegated helper/RPC for assignment checks or can keep service-role writes protected entirely by server authorization.

Open decisions for Feature 092:

- Exact low-risk role-definition capability allowlist.
- Whether delegated users can see non-manageable role definitions read-only.
- Whether to add separate delegated-safe role editor RPCs instead of changing owner/admin RPCs.
- Whether archived role visibility differs for delegated role managers.

Open decisions for Feature 093:

- Whether any tenant-wide reviewer access delegation is safe.
- Whether project reviewer access delegation requires project-level administrative context.
- Whether `reviewer_access.manage` should include revoke-only, grant-only, or both.

## 16. No-code implementation prompt

Create or update only `docs/rpi/090-role-administration-delegation/plan.md` to record that Feature 090 defers role administration delegation. Do not edit `src`, Supabase migrations, tests, messages, UI files, or the capability catalog. Do not add `custom_roles.manage`, `custom_roles.assign`, `reviewer_access.manage`, `roles.manage`, or `roles.assign`. After writing the document, read it back to verify it is complete UTF-8 markdown with no truncation or encoding artifacts.
