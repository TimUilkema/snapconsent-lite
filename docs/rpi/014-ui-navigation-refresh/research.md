# 014 UI Navigation Refresh - Research

## Goal

Improve the current UI and UX without changing the product model or adding new backend architecture.

This feature focuses on:

- clearer navigation between existing pages
- stronger page structure on desktop and mobile
- a lighter, more consistent visual system
- reducing the "single long vertical page" feeling, especially on project detail screens

## Ground Truth Audit

The repository currently exposes these page-level routes:

- `/`
  - marketing-style landing page
- `/login`
  - sign-in form
- `/dashboard`
  - protected page, currently mostly placeholder account info
- `/projects`
  - protected project list + create-project form
- `/projects/[projectId]`
  - protected project detail page with invites, consent details, matching UI, and assets
- `/i/[token]`
  - public consent form page
- `/r/[token]`
  - public revoke page

Relevant files:

- [src/app/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/page.tsx)
- [src/app/login/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/login/page.tsx)
- [src/app/(protected)/layout.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/layout.tsx)
- [src/app/(protected)/dashboard/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/dashboard/page.tsx)
- [src/app/(protected)/projects/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/projects/page.tsx)
- [src/app/(protected)/projects/[projectId]/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/projects/[projectId]/page.tsx)
- [src/app/i/[token]/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/i/[token]/page.tsx)
- [src/app/r/[token]/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/r/[token]/page.tsx)

## Current Navigation Behavior

Current navigation is minimal and inconsistent:

- Protected pages do not share a persistent header, toolbar, or primary nav.
- `dashboard` links to `projects`, but `projects` does not link back to `dashboard`.
- project detail relies on one plain "Back to projects" link at the bottom of a very long page.
- public pages link back to home only.

This is functional but weak:

- users must scroll to navigate between long sections
- there is no stable sense of "where am I?"
- the project detail page has no local section navigation even though it contains distinct work areas

## Current Visual System

The app is already light-themed, which matches the requested direction.

Current style characteristics:

- large rounded containers (`rounded-[28px]`)
- semi-translucent shells (`app-shell`, `content-card`)
- decorative background gradients and blur in [src/app/globals.css](/C:/Users/tim/projects/snapconsent-lite/src/app/globals.css)
- repeated card-in-card composition

Observed UX issues:

- too much content is pushed into one centered vertical column
- desktop width is underused in protected pages
- hierarchy is weak because most sections share similar card treatment
- some pages still read like prototypes rather than task-focused product screens

## High-Impact Screens

### 1. Protected frame

[src/app/(protected)/layout.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/layout.tsx) currently only performs auth/tenant checks and returns children directly.

Implication:

- no shared app chrome
- duplicated page-level wrappers
- no predictable desktop/mobile navigation

### 2. Projects list

[src/app/(protected)/projects/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/projects/page.tsx) currently stacks:

- page title
- create project form
- existing projects list

This works, but it is sparse on desktop and gives no quick overview or obvious route back to other protected areas.

### 3. Project detail page

[src/app/(protected)/projects/[projectId]/page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/projects/[projectId]/page.tsx) is the main workflow page and currently contains:

- project header
- create invite form
- invites list
- expandable consent details
- matching panel inside invite details
- assets upload
- assets list

This is the biggest UX pain point:

- very long page
- no top toolbar or breadcrumbs
- no in-page anchors for `Invites` / `Assets`
- key actions are visually buried

### 4. Public consent / revoke pages

These are serviceable, but visually disconnected from the protected app and still use the same centered-card pattern.

## Existing Components Worth Preserving

These components already solve real tasks and should be re-used rather than redesigned from scratch:

- [src/components/projects/assets-list.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/assets-list.tsx)
- [src/components/projects/assets-upload-form.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/assets-upload-form.tsx)
- [src/components/projects/consent-asset-matching-panel.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/consent-asset-matching-panel.tsx)
- [src/components/projects/create-project-form.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/create-project-form.tsx)
- [src/components/projects/create-invite-form.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/create-invite-form.tsx)
- [src/components/projects/previewable-image.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/previewable-image.tsx)

The better approach is structural UI improvement:

- navigation
- spacing
- sectioning
- layout balance
- consistent control styles

## Constraints

- Keep the app light.
- Keep the existing routes.
- Do not add public endpoints.
- Do not move business logic to the client.
- Do not change tenant/auth behavior.
- Preserve mobile usability.
- Keep changes reviewable and avoid a full visual rewrite for every component.

## Risks

### Layout regressions

The project detail page is dense and already contains interactive UI. Layout changes must avoid breaking:

- consent detail expansion
- matching panel interactions
- assets filters and pagination

### Mobile regressions

A wider desktop layout must still collapse cleanly on phones.

### Overdesign risk

`UNCODEXIFY.md` explicitly bans generic AI-dashboard styling. The redesign should stay normal:

- real app header
- standard cards
- simple tabs/anchors
- calm borders and spacing

No hero-dashboard treatment inside protected pages.

## Recommendation

Implement a bounded UI refresh centered on structure, not ornament:

1. Add a shared protected header with simple primary navigation and session actions.
2. Widen the protected content area and reduce dependence on one oversized outer card.
3. Rework the projects page into a two-column layout on desktop.
4. Rework the project detail page around:
   - breadcrumb/top action bar
   - compact project summary strip
   - simple local section navigation (`Invites`, `Assets`)
   - better desktop column use for forms and content
5. Make the public pages visually consistent with the same light design language.
6. Keep component-level changes targeted and mostly presentational.

This is small enough for one bounded feature cycle and directly addresses the current UX problems without architecture drift.
