# Feature 037 Research: Consent Matching Panel Layout

## Goal

Improve the consent-form matching UI so the photo grids are not constrained to two narrow columns inside a long scrolling panel.

## Inputs reviewed

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.MD`
- `docs/rpi/README.md`
- user screenshot of the current consent card layout
- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`

## Current behavior

The matching UI currently renders:

- upload section
- a two-column layout:
  - left: review project photos
  - right: current assignments

Inside both sections, the asset lists are rendered as:

- `sm:grid-cols-2`

This creates two problems visible in the screenshot:

1. the overall panel width is split between two sibling sections
2. each section still only renders two asset columns

That combination leaves each thumbnail extremely narrow and forces long vertical scrolling.

## Constraints

- preserve the existing project visual language
- keep controls and actions clear
- do not introduce decorative dashboard styling
- maintain mobile usability

## Recommended direction

Use a single-column panel flow for the matching workspace:

- upload
- review project photos
- current assignments

Then let each asset list use the available width with denser responsive grids:

- `sm:grid-cols-2`
- `lg:grid-cols-3`
- `2xl:grid-cols-4` where appropriate

This keeps the consent cards vertically stacked, which the user said is acceptable, while removing the unnecessary narrow split inside each consent detail view.
