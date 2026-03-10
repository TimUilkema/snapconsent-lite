# 014 UI Navigation Refresh - Plan

## Scope

Improve navigation clarity and page structure across the existing UI while preserving current routes, server behavior, and matching workflows.

This plan is intentionally bounded:

- no new backend endpoints
- no schema changes
- no route redesign
- no major component rewrites beyond layout and presentation

## Ground-Truth Summary

Validated from repository code:

- protected pages do not currently share a navigation shell
- project detail is the primary workflow screen and is overly vertical
- projects page underuses desktop width
- public pages use a separate but visually similar centered card pattern
- most UX issues are structural, not missing backend capabilities

## Implementation Steps

### Step 1 - Add shared protected app chrome

Modify:

- [src/app/(protected)/layout.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/layout.tsx)

Changes:

- wrap protected pages in a shared light app frame
- add a simple top header with:
  - app name
  - primary nav links for `Dashboard` and `Projects`
  - sign-out action
- support mobile by allowing nav items to wrap or stack cleanly

Goal:

- users always know where they are
- protected navigation becomes consistent

### Step 2 - Tighten the global visual system

Modify:

- [src/app/globals.css](/C:/Users/tim/projects/snapconsent-lite/src/app/globals.css)
- [src/app/layout.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/layout.tsx)

Changes:

- keep light theme
- reduce decorative shell feel
- standardize surface, border, shadow, and width behavior
- widen the main usable area modestly for desktop
- keep mobile spacing intact

Goal:

- cleaner, more normal product UI
- less floating-card feel

### Step 3 - Rework dashboard into a real entry page

Modify:

- [src/app/(protected)/dashboard/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/dashboard/page.tsx)

Changes:

- replace placeholder account-only view with a simple workspace landing page
- include quick routes into active work:
  - projects
  - create new project
- keep account/session information secondary

Goal:

- dashboard becomes useful instead of a dead-end

### Step 4 - Rework projects list page

Modify:

- [src/app/(protected)/projects/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/projects/page.tsx)
- [src/components/projects/create-project-form.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/create-project-form.tsx)

Changes:

- use desktop two-column layout:
  - left: create project form
  - right: projects list
- improve project list item hierarchy
- add clearer page toolbar/title area

Goal:

- better use of horizontal space
- faster navigation into projects

### Step 5 - Rework project detail page around sections and actions

Modify:

- [src/app/(protected)/projects/[projectId]/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/projects/[projectId]/page.tsx)
- [src/components/projects/create-invite-form.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/create-invite-form.tsx)
- [src/components/projects/assets-list.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/assets-list.tsx)
- [src/components/projects/consent-asset-matching-panel.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/consent-asset-matching-panel.tsx)

Changes:

- add top breadcrumb/back action near the top, not bottom only
- add a compact project summary/action strip
- add local section navigation with anchor links:
  - `Invites`
  - `Assets`
- restructure desktop layout:
  - summary + invite creation in a balanced top grid
  - invites and assets as clear sections below
- keep consent detail expansion but improve surrounding layout hierarchy

Goal:

- reduce "one endless page"
- make major sections reachable without scrolling blindly

### Step 6 - Align public pages with the updated system

Modify:

- [src/app/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/page.tsx)
- [src/app/login/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/login/page.tsx)
- [src/app/i/[token]/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/i/[token]/page.tsx)
- [src/app/r/[token]/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/r/[token]/page.tsx)
- [src/components/public/public-consent-form.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/public/public-consent-form.tsx)

Changes:

- keep a lighter visual language consistent with protected pages
- improve spacing, section order, and button hierarchy
- keep public flows clear and mobile-friendly

Goal:

- smoother visual continuity across the product

## Files To Modify

- [src/app/layout.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/layout.tsx)
- [src/app/globals.css](/C:/Users/tim/projects/snapconsent-lite/src/app/globals.css)
- [src/app/(protected)/layout.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/layout.tsx)
- [src/app/(protected)/dashboard/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/dashboard/page.tsx)
- [src/app/(protected)/projects/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/projects/page.tsx)
- [src/app/(protected)/projects/[projectId]/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/projects/[projectId]/page.tsx)
- [src/app/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/page.tsx)
- [src/app/login/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/login/page.tsx)
- [src/app/i/[token]/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/i/[token]/page.tsx)
- [src/app/r/[token]/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/r/[token]/page.tsx)
- [src/components/projects/create-project-form.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/create-project-form.tsx)
- [src/components/projects/create-invite-form.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/create-invite-form.tsx)
- [src/components/projects/assets-list.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/assets-list.tsx)
- [src/components/projects/consent-asset-matching-panel.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/consent-asset-matching-panel.tsx)
- [src/components/public/public-consent-form.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/public/public-consent-form.tsx)

## Navigation Decisions

- Primary protected navigation: `Dashboard`, `Projects`
- Project page local navigation: anchor links for major sections
- Keep public pages simple and focused; no extra app chrome there

## Design Rules

- light UI only
- standard radii and shadows
- avoid decorative labels and hero-dashboard copy
- use width and columns to improve scanability
- keep controls normal and explicit

## Edge Cases

- mobile header wrapping must remain usable
- expanded consent details must still work after layout changes
- anchor links must not interfere with `details` interaction
- long invite lists and asset grids must still scroll naturally
- auth/session behavior must remain unchanged

## Testing and Verification

1. Run `npm run lint`.
2. Run `npm test`.
3. Manual desktop checks:
   - login
   - protected header/nav
   - dashboard navigation
   - projects list layout
   - project detail section navigation
   - consent details expansion
   - matching panel usability
4. Manual mobile checks:
   - header/nav wrapping
   - project detail readability
   - public consent form upload flow layout
   - revoke page layout

## Success Criteria

- navigation between protected pages is obvious without relying on bottom-page links
- project detail page feels sectioned instead of like a single scrolling block
- desktop uses more horizontal space without breaking mobile
- UI remains light, calm, and normal rather than overly decorative
