# Feature 103 Plan - Organization Users Page Simplification and Inline Advanced Role Settings

## Feature ID

Feature 103 - Organization Users Page Simplification and Inline Advanced Role Settings

## Inputs and ground truth

Planning inputs read in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/SUMMARY.md`
5. `docs/rpi/PROMPTS.md`
6. `docs/rpi/README.md`
7. `UNCODEXIFY.md`
8. `docs/rpi/103-organization-users-simplification-advanced-role-settings/research.md`
9. Targeted live verification of owner/admin member UI, delegated member UI, messages, and affected tests.

Ground truth order for implementation:

1. Live code in `src/`.
2. Live migrations in `supabase/migrations/`.
3. Current tests in `tests/`.
4. Feature 103 research and this plan.
5. Older RPI documents.

This plan is UI/UX and information architecture only. It must not change runtime authorization behavior, database schema, fixed role semantics, custom role semantics, scoped assignment semantics, reviewer access semantics, photographer workspace assignment semantics, or effective permission resolver behavior.

## Research summary

The Organization Users page is `/members`, rendered by `src/app/(protected)/members/page.tsx`.

The page has three current server-side branches:

- Fixed owner/admin users get `getTenantMemberManagementData(...)` and the full `MemberManagementPanel`.
- Delegated organization-user custom-role users get `getOrganizationUserDirectoryData(...)` and the reduced `DelegatedMemberManagementPanel`.
- Users with no organization-user access get the read-only branch.

The full owner/admin view currently renders this default order:

1. Status message.
2. Invite member.
3. Large static `Role reference`.
4. `CustomRoleManagementSection`.
5. Current members table.
6. Pending invites.

The owner/admin table currently mixes daily member management with advanced role administration:

- fixed role changes and removal;
- reviewer access grant/revoke controls;
- custom role assignments and scoped assignment controls;
- scope warnings and zero-effective assignment warnings;
- effective access `Access` button and lazy detail row.

The delegated view is already a separate reduced client component and intentionally receives no role-editor, custom-role-assignment, reviewer-access, or effective-access data.

## Chosen scope

Include:

- Keep `/members` as the only page and route.
- Keep the existing owner/admin full data path.
- Keep the existing delegated reduced data path.
- Keep the existing no-access path.
- Add an owner/admin-only inline advanced role settings toggle.
- Default advanced role settings to collapsed.
- Use local React state only.
- Simplify the owner/admin default view around invite controls, current members, pending invites, fixed/main role, access summary, and basic actions.
- Hide advanced owner/admin role controls by default and reveal them inline on the same page.
- Remove the large static `Role reference` from the default rendered view.
- Add focused English and Dutch i18n keys for new UI copy.
- Add focused UI and regression tests for the new default/advanced split.

## Explicit deferred items

Defer:

- Runtime authorization changes.
- New routes, pages, tabs backed by routes, or modal-only advanced pages.
- Database migrations.
- New capabilities.
- Delegated role administration.
- Backend role, capability, or database concept renames.
- Custom role semantic changes.
- Scoped assignment semantic changes.
- Reviewer access semantic changes.
- Photographer workspace assignment changes.
- Effective resolver changes.
- Persisted advanced preference.
- URL query state such as `advanced=1`.
- Separate advanced data loading endpoints.
- Broad member-management table rewrite.
- Moving custom role assignments into a new drawer or separate editor.
- Replacing reviewer access or photographer assignments with custom roles.
- Removing old unused `members.roleReference.*` i18n keys as mandatory cleanup.

## Chosen architecture

Use the existing `MemberManagementPanel` owner/admin client component as the state owner.

Add local state:

- `showAdvancedRoleSettings`, default `false`.

Add one toggle handler:

- Toggles `showAdvancedRoleSettings`.
- When closing advanced settings, clear `expandedEffectiveAccessUserId` so hidden effective access details are not left open behind collapsed UI.
- Keep `effectiveAccessSummaries` cached in memory if already loaded.

Pass the advanced state into `MemberManagementPanelView`:

- Add `showAdvancedRoleSettings: boolean`.
- Add `onToggleAdvancedRoleSettings: () => void`.

For deterministic render tests, make these props explicit in new tests. Existing tests that intentionally assert advanced controls must pass `showAdvancedRoleSettings: true`. Existing tests that should represent the default state should pass `false` or rely on a default value if the implementation chooses backwards-compatible optional props.

Do not change `src/app/(protected)/members/page.tsx` beyond any unavoidable import/type fallout. Server data loading remains unchanged for owner/admin users.

Do not change `DelegatedMemberManagementPanel` behavior. It must not receive or render the advanced toggle in Feature 103.

## Exact default owner/admin view plan

Default owner/admin order:

1. Status message, when present.
2. Invite member.
3. Inline advanced role settings toggle.
4. Current members.
5. Pending invites.

Default owner/admin members table columns:

1. Email.
2. Role.
3. Access summary.
4. Joined.
5. Actions.

Default-visible controls:

- Invite email input.
- Invite fixed role select for admin, reviewer, photographer.
- Invite submit button.
- Fixed role select for editable non-owner rows.
- Save role for editable non-owner rows.
- Remove for removable non-owner rows.
- Owner protected label for owner rows.
- Pending invite role select/resend/revoke controls as currently allowed.

Default-hidden controls:

- Custom role editor.
- Custom role assignment cards.
- Custom role assignment selectors.
- Scoped assignment target selectors.
- Scope warnings, ignored capability detail, and zero-effective assignment warnings.
- Reviewer access grant/revoke buttons.
- Effective access `Access` buttons and detail rows.
- The large static `Role reference`.

Default copy:

- Keep page title `members.title`.
- Update page subtitle to focus on daily management, for example: `Invite users and manage their main organization role.`
- Keep invite role helper because it uses already-loaded fixed role descriptions and is directly tied to invite decisions.
- Keep owner protection/removal explanation near the members table, but make custom-role assignment guidance advanced-only.

## Exact inline advanced toggle plan

Placement:

- Render immediately after the invite section and before the current members section.
- Use a normal bordered/plain row or compact section, consistent with existing member page styling.
- Do not create a decorative card or a new navigation concept.

Button behavior:

- Collapsed label: `Show advanced role settings`.
- Expanded label: `Hide advanced role settings`.
- `type="button"`.
- `aria-expanded={showAdvancedRoleSettings}`.
- `aria-controls` pointing to the advanced section container id, for example `members-advanced-role-settings`.
- No route change.
- No URL query update.
- No persisted preference.
- No automatic scroll.

Visibility:

- Render only in `MemberManagementPanel`, which is already owner/admin-only.
- Do not render in `DelegatedMemberManagementPanel`.
- Do not render in the no-access server branch.

Advanced section:

- When open, render inline on the same page.
- Use a plain `div`/section with a concise title and helper text.
- The advanced area should not be a separate page, route, tab route, or modal-only experience.

## Exact Role reference simplification plan

Chosen treatment:

- Remove the large static `Role reference` section from rendered UI entirely for Feature 103.
- Do not keep a shortened `Main role guide` in the first implementation.
- Replace the lost guidance with concise contextual helper copy near controls that need it.

Rationale:

- The current section is a large capability catalog, not day-to-day member management.
- It duplicates information already present in fixed role descriptions, custom role editor capability labels, reviewer access controls, and effective access explanations.
- Keeping it hidden behind advanced settings would still preserve a large static catalog that is less useful than contextual copy.
- Leaving the old message keys temporarily unused is lower risk than coupling this UI simplification to message cleanup.

Contextual guidance to keep or add:

- Invite selected role help remains visible.
- Members table helper should explain main role and owner protection:
  - `The main role controls baseline organization access. Owner rows stay protected.`
- Advanced helper should explain additional access:
  - `Advanced settings manage custom roles, review access, and access details for owners and admins.`

Do not rename:

- `MembershipRole`.
- `MEMBERSHIP_ROLES`.
- `ROLE_CAPABILITIES`.
- capability keys.
- custom role backend concepts.
- database columns/tables.

## Exact advanced controls grouping plan

Use one page-level advanced mode with two physical placements:

1. A top advanced section after the toggle.
2. Advanced columns and controls inside the current members table when advanced mode is open.

Top advanced section contents:

- Advanced title/helper text.
- `CustomRoleManagementSection` for custom role definitions.

Members table advanced contents:

- Reviewer access column.
- Custom roles column with existing assigned role cards, remove buttons, assignment selectors, target selectors, and warnings.
- Effective access button and lazy detail row.

Do not create separate advanced cards for every group in Feature 103. The existing custom role editor already has its own section. Reviewer access, assignment controls, and effective access are member-row-specific and should stay with the relevant row when advanced mode is open.

When advanced is open, the members table columns should be:

1. Email.
2. Role.
3. Reviewer access.
4. Custom roles.
5. Joined.
6. Actions.

When advanced is closed, the members table columns should be:

1. Email.
2. Role.
3. Access summary.
4. Joined.
5. Actions.

The implementation may conditionally render a single table with different columns rather than duplicating the table.

## Exact access summary plan

Add a default-visible access summary column for owner/admin users only.

Data sources:

- `data.reviewerAccess`, already loaded in the owner/admin data path.
- `data.customRoleAssignments`, already loaded in the owner/admin data path.
- `member.role`, already loaded.

Do not use:

- `getMemberEffectiveAccessSummary`.
- new resolver calls.
- photographer workspace assignment data, because it is not already included in owner/admin page data except through lazy effective access.

Summary model:

- Build a short list of summary items per row.
- If the member has assigned custom roles:
  - Show `Additional access: {count} role` or `Additional access: {count} roles`.
- If the member has no assigned custom roles:
  - Do not add a custom role item.
- If the member has fixed reviewer role:
  - If tenant-wide reviewer access is active, show `Review access: all projects`.
  - Else if project reviewer assignments count is greater than zero, show `Review access: {count} project` or `Review access: {count} projects`.
  - Else show `Review access: not granted`.
- If there are no summary items, show `No additional access`.

Exact labels:

- Column label: `Access summary`.
- Empty state: `No additional access`.
- Custom roles: `Additional access: {count, plural, one {# role} other {# roles}}`.
- Reviewer all projects: `Review access: all projects`.
- Reviewer project count: `Review access: {count, plural, one {# project} other {# projects}}`.
- Reviewer no grants: `Review access: not granted`.

Accuracy constraints:

- Do not call this "effective access".
- Do not imply the summary is complete.
- Do not summarize photographer workspace assignments in default mode.
- Do not show assigned custom role names by default in Feature 103; counts are enough and reduce width/noise.

## Exact delegated view plan

Leave the delegated view unchanged in Feature 103.

The delegated component:

- Must not render the advanced toggle.
- Must not render custom role editor data.
- Must not render custom role assignment controls.
- Must not render reviewer access administration controls.
- Must not render effective access explanations.
- Must continue using `OrganizationUserDirectoryData`.
- Must continue enforcing row-level allowed invite, role-change, remove, resend, and revoke controls based on server-provided decisions.

No delegated copy cleanup is included unless required by compile/test fallout. Keeping this branch unchanged is the safest first implementation because delegated users already see the reduced surface.

## Exact component/refactor plan

Modify `src/components/members/member-management-panel.tsx` only for the owner/admin UI split.

Planned component changes:

- Add `showAdvancedRoleSettings` local state in `MemberManagementPanel`.
- Add `toggleAdvancedRoleSettings` handler.
- Pass `showAdvancedRoleSettings` and `onToggleAdvancedRoleSettings` to `MemberManagementPanelView`.
- Extend `MemberManagementPanelViewProps` with the two advanced props.
- Add small local helpers in `MemberManagementPanelView`:
  - access summary item builder;
  - access summary renderer;
  - optional reviewer summary helper.
- Remove the rendered `Role reference` section from `MemberManagementPanelView`.
- Remove imports and helper functions used only by the old `Role reference` UI if no other code uses them:
  - `Fragment` remains needed for table rows.
  - `MEMBERSHIP_ROLES`, `CAPABILITY_GROUPS`, `CAPABILITY_LABEL_KEYS`, `roleHasCapability`, `TenantCapability`, `MembershipRole`, and `getRoleCapabilityGroups` may become unused after removing Role reference and should be cleaned up if unused.
- Keep `CustomRoleManagementSection` import because advanced mode still renders it.
- Keep effective access lazy code, but render the `Access` button and detail row only when `showAdvancedRoleSettings` is true.

Avoid:

- New component files unless the owner/admin component becomes materially harder to read.
- Broad table extraction.
- Duplicating full table markup.
- Any service, route, migration, or permission changes.

Tests may require the view props to be optional for existing helper reuse. If optional props are used, default to:

- `showAdvancedRoleSettings = false`.
- `onToggleAdvancedRoleSettings = () => undefined`.

Any existing test that asserts advanced controls must be updated to pass `showAdvancedRoleSettings: true`.

## Exact i18n plan

Update English and Dutch messages together.

Add under `members.advancedRoleSettings`:

- `show`: `Show advanced role settings`
- `hide`: `Hide advanced role settings`
- `title`: `Advanced role settings`
- `description`: `Manage custom roles, review access, and access details. These settings are available to owners and admins only.`

Add under `members.accessSummary`:

- `column`: `Access summary`
- `none`: `No additional access`
- `customRoleCount`: `Additional access: {count, plural, one {# role} other {# roles}}`
- `reviewAllProjects`: `Review access: all projects`
- `reviewProjectCount`: `Review access: {count, plural, one {# project} other {# projects}}`
- `reviewNotGranted`: `Review access: not granted`

Add or update under `members.membersTable`:

- Keep `title`.
- Update `subtitle` to concise main-role guidance:
  - `The main role controls baseline organization access. Owner rows stay protected.`
- Keep `removalExplanation`.
- Add `advancedSubtitle` only if implementation needs separate advanced table copy. Prefer avoiding this key unless the table needs two distinct helper lines.

Update:

- `members.subtitle` to daily management copy:
  - `Invite users and manage their main organization role.`

Move default-hidden guidance:

- `members.customRoleAssignments.note` should be rendered only when advanced settings are open, or as part of advanced copy. The key can remain unchanged.

Leave in place for this feature:

- `members.roleReference.*`
- `members.capabilityGroups.*`
- `members.capabilities.*`

Those keys may still be used by other tests or future advanced help. Removing unused keys can be a later cleanup after Feature 103 ships.

Do not add hardcoded user-facing strings.

## Security and authorization considerations

The advanced toggle is presentation state only. It is not an authorization boundary.

Security requirements:

- Keep `/members` server component tenant resolution unchanged.
- Keep `ensureTenantId` and `resolveOrganizationUserAccess` behavior unchanged.
- Keep owner/admin `getTenantMemberManagementData` behavior unchanged.
- Keep delegated `getOrganizationUserDirectoryData` behavior unchanged.
- Keep all route handlers deriving tenant server-side.
- Never accept `tenant_id` from client input.
- Do not change service authorization checks.
- Do not change fixed owner/admin-only role administration enforcement.
- Do not allow delegated organization-user permissions to list or mutate custom roles, custom role assignments, reviewer access, or effective access explanations.

Existing server-side enforcement remains authoritative:

- Member listing/invites/role changes/removal: member management services and organization-user access helpers.
- Custom role editor: fixed owner/admin member-management checks.
- Custom role assignment/revocation: fixed owner/admin member-management checks.
- Reviewer access grant/revoke: fixed owner/admin checks.
- Effective access explanation: owner/admin-only `getMemberEffectiveAccessSummary`.

Because owner/admin full data remains loaded even when advanced UI is collapsed, Feature 103 does not reduce data transfer or server load. That is acceptable and intentional for this bounded UI-only cycle.

## Edge cases and risks

Owners/admins may think controls disappeared:

- Keep the advanced toggle near the top, directly after invite controls.
- Use direct button copy.

Warnings are hidden until advanced opens:

- This is acceptable because assignment controls are hidden too.
- When advanced opens, keep all existing scope warnings, ignored capability details, and zero-effective warnings visible exactly where assignment decisions are made.

No custom roles:

- Default access summary should show `No additional access` unless reviewer access adds a summary item.
- Advanced custom role assignment controls should keep the existing `Create an active custom role before assigning one.` behavior.

Reviewer rows:

- Default summary must distinguish fixed reviewer membership from actual review access:
  - all projects;
  - project count;
  - not granted.
- Reviewer grant/revoke buttons remain advanced-only.

Owner protected row:

- Owner rows remain non-editable and non-removable.
- Owner protected label remains visible in default actions.

Delegated custom-role users:

- No advanced toggle.
- No advanced data.
- Existing delegated reduced controls only.

Effective access:

- No eager calls in default mode.
- No eager calls when advanced opens.
- Fetch only after an owner/admin clicks the per-row `Access` button in advanced mode.
- Closing advanced should hide any open effective detail row.

Layout:

- Default table should be narrower than the current table by replacing reviewer/custom role columns with one access summary column.
- Advanced table can remain wide and horizontally scrollable like today.

Loading/error states:

- Full page load behavior remains unchanged.
- Effective access loading/error states remain inside the lazy detail area and are reachable only in advanced mode.

i18n:

- English and Dutch keys must be added together.
- No hardcoded strings.
- Existing unused Role reference keys may remain.

## Test plan

Add a focused Feature 103 UI test file:

- `tests/feature-103-organization-users-simplification.test.ts`

Recommended tests:

1. Owner/admin default render hides advanced controls.
   - Render `MemberManagementPanelView` with `showAdvancedRoleSettings: false`.
   - Assert invite, current members, pending invites, role select/basic actions, and `Show advanced role settings` render.
   - Assert `Role reference`, `Create custom role`, `Assign role`, `Grant all projects`, `Revoke all projects`, and effective access `Access` button do not render.

2. Owner/admin default render shows access summary.
   - Use fixture data with one reviewer with tenant-wide access, one reviewer with project grants, one reviewer with no grants, and one member with custom role assignments.
   - Assert access summary strings render from already-loaded data.
   - Assert no effective access details render.

3. Owner/admin advanced render reveals controls inline.
   - Render `MemberManagementPanelView` with `showAdvancedRoleSettings: true`.
   - Assert `Hide advanced role settings`, `Advanced role settings`, `Create custom role`, reviewer access buttons, custom role assignment controls, scope warning text, and effective access `Access` button render.
   - Assert `Role reference` still does not render.

4. Effective access remains advanced-only and lazy.
   - In default render, assert no `Access` button and no effective access detail row.
   - In advanced render without expanded state, assert the button exists but no detail row content exists.
   - In advanced render with `expandedEffectiveAccessUserId` and a provided summary, assert the existing detail content renders.

5. Delegated view remains reduced.
   - Render `DelegatedMemberManagementPanelView`.
   - Assert no `Show advanced role settings`, no `Advanced role settings`, no custom role editor, no reviewer grant/revoke controls, and no effective access button.
   - Keep existing delegated allowed-controls assertions from Feature 089 intact.

6. i18n parity for new keys.
   - Import `messages/en.json` and `messages/nl.json`.
   - Check the exact new key paths under `members.advancedRoleSettings` and `members.accessSummary`.
   - Follow the simple key-path pattern used by Feature 102 tests.

Update existing tests:

- `tests/feature-080-role-capability-catalog.test.ts`
  - Its UI test currently asserts `Role reference` and capability catalog text in the member panel. Update it to keep role/capability catalog assertions at the helper/catalog level, not through rendered `Role reference`.
  - If it still needs advanced UI assertions, pass `showAdvancedRoleSettings: true` and assert custom role editor remains available there.

- `tests/feature-084-custom-role-assignment-foundation.test.ts`
  - If it renders assignment controls, pass `showAdvancedRoleSettings: true`.

- `tests/feature-091-owner-admin-role-administration-consolidation.test.ts`
  - Tests that assert custom role assignment/reviewer access UI must render advanced mode.
  - Service authorization tests should be unchanged.

- `tests/feature-093-scoped-custom-role-assignment-foundation.test.ts`
  - Tests that assert scoped assignment controls and warnings must render advanced mode.
  - Service authorization and scoped assignment tests should be unchanged.

- `tests/feature-096-permission-cleanup-and-effective-access-ui.test.ts`
  - Service tests remain unchanged.
  - If UI effective access tests are added or existing ones render the panel, use advanced mode.

Regression commands:

- Targeted UI and member-management tests with the repo's `tsx --test --test-concurrency=1` pattern.
- At minimum after implementation:
  - `npx tsx --test --test-concurrency=1 tests/feature-080-role-capability-catalog.test.ts tests/feature-084-custom-role-assignment-foundation.test.ts tests/feature-089-organization-user-role-change-and-removal-custom-role-enforcement.test.ts tests/feature-091-owner-admin-role-administration-consolidation.test.ts tests/feature-093-scoped-custom-role-assignment-foundation.test.ts tests/feature-096-permission-cleanup-and-effective-access-ui.test.ts tests/feature-103-organization-users-simplification.test.ts`
- Run `npm test` if practical after targeted tests pass.
- Run `npm run lint`.

## Implementation phases

### Phase 1 - Owner/admin advanced state and Role reference removal

- Add local advanced toggle state to `MemberManagementPanel`.
- Add advanced props to `MemberManagementPanelView`.
- Render the toggle after invite controls.
- Remove the rendered `Role reference` section.
- Render `CustomRoleManagementSection` only when advanced mode is open.
- Add English/Dutch advanced toggle and advanced helper keys.
- Update existing tests that break from new props or Role reference removal.

Validation:

- Targeted render tests for the owner/admin panel.
- Existing role capability catalog tests adjusted away from UI Role reference dependency.

### Phase 2 - Default table access summary and advanced table split

- Add access summary helper/rendering inside `MemberManagementPanelView`.
- In default mode, render `Access summary` instead of reviewer/custom role columns.
- In advanced mode, render existing reviewer/custom role columns and controls.
- Keep save/remove/owner protected actions visible in both modes.
- Hide effective access button in default mode.
- Ensure advanced effective access detail row uses correct `colSpan` for the advanced table only.
- Add English/Dutch access summary keys.

Validation:

- New Feature 103 default and advanced render tests.
- Existing scoped assignment/reviewer access UI tests updated to advanced mode.

### Phase 3 - Effective access and delegated/no-access regression

- Ensure closing advanced clears `expandedEffectiveAccessUserId`.
- Keep effective access fetch lazy and only reachable from advanced mode.
- Add/adjust effective access UI tests.
- Add delegated reduced-boundary assertions that no advanced toggle appears.
- Confirm no server page or service behavior changed.

Validation:

- Feature 089 delegated UI tests.
- Feature 091 role administration boundary tests.
- Feature 096 effective access tests.
- Feature 103 delegated/default/advanced tests.

### Phase 4 - Final cleanup and full validation

- Remove unused imports and dead helper code left by Role reference removal.
- Ensure English/Dutch new key parity.
- Run lint.
- Run targeted test command.
- Run full `npm test` if practical.

## Scope boundaries

Implementation must not:

- Add a route.
- Add a page.
- Add URL state.
- Persist advanced state.
- Split owner/admin data loading.
- Change delegated data shape.
- Change service authorization.
- Change role/capability semantics.
- Add database migrations.
- Introduce hardcoded UI strings.
- Hide owner/admin role administration in a way that cannot be discovered and opened from `/members`.

Implementation may:

- Conditionally render existing owner/admin controls based on local state.
- Add small presentational helpers in `member-management-panel.tsx`.
- Update existing tests to render advanced state where they are specifically testing advanced controls.
- Leave old Role reference i18n keys unused.

## Concise implementation prompt

Implement Feature 103 by following `docs/rpi/103-organization-users-simplification-advanced-role-settings/plan.md` as the implementation contract.

Before coding, read:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `UNCODEXIFY.md`
- `docs/rpi/103-organization-users-simplification-advanced-role-settings/plan.md`

Keep deviations minimal.

Implement in phases:

1. Add the owner/admin local advanced toggle, remove the rendered Role reference, and hide the custom role editor by default.
2. Add the default access summary column and conditionally render advanced reviewer/custom role/effective access controls.
3. Preserve delegated/no-access behavior and add focused tests.
4. Clean up unused imports/helpers, add English/Dutch i18n keys, and run targeted validation.

Additional instructions:

- Keep `/members` as the route.
- Do not change runtime authorization, services, migrations, fixed role semantics, custom role semantics, reviewer access semantics, or effective resolver behavior.
- Do not show the advanced toggle to delegated member-management users in this first version.
- Keep effective access lazy and owner/admin-only.
- Do not introduce hardcoded user-facing strings.

At the end, report:

- what changed;
- any minimal deviations from this plan;
- tests run and results.
