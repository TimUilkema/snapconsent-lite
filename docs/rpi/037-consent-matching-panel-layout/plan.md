# Feature 037 Plan: Consent Matching Panel Layout

## Goal

Make the consent matching area use horizontal space more effectively so image grids are wider and less scroll-heavy.

## Implementation steps

### 1. Flatten the matching panel layout

In `src/components/projects/consent-asset-matching-panel.tsx`:

- replace the two-column review/current-assignments split with a vertical stack
- keep upload as a separate top section

### 2. Widen the asset grids

Update the responsive list layouts:

- review assets:
  - `sm:grid-cols-2`
  - `lg:grid-cols-3`
  - `2xl:grid-cols-4`
- linked assets:
  - `sm:grid-cols-2`
  - `lg:grid-cols-3`
  - `2xl:grid-cols-4`

### 3. Tighten card density slightly

Adjust card padding and metadata layout so more useful image area is visible without making the UI feel cramped.

### 4. Verification

Run:

- `npm run lint`

Manual verification:

- open a project with several linked and unlinked photos
- confirm the matching panel uses more of the card width
- confirm larger screens show more than two image columns
