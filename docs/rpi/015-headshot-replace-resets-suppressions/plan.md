# 015 Headshot Replace Resets Suppressions - Plan

## Scope

Bounded behavior change:

- preserve the existing 010/011 queue and worker design
- preserve normal manual unlink suppression behavior
- reset suppressions only when a consent headshot is replaced

No schema change is needed.

## Ground-Truth Validation

Validated in repository code:

- unlink writes suppression rows in [src/lib/matching/consent-photo-matching.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/consent-photo-matching.ts)
- worker skips suppressed pairs in `applyAutoMatches`
- headshot replacement route currently replaces the headshot link and enqueues a rematch job, but does not clear suppressions

## Implementation Steps

### Step 1 - Add a scoped suppression reset helper

Modify:

- [src/lib/matching/consent-photo-matching.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/consent-photo-matching.ts)

Add:

- a small exported helper that deletes `asset_consent_link_suppressions` rows for one `(tenant_id, project_id, consent_id)` scope

Requirements:

- server-side only
- tenant/project scoped
- idempotent

### Step 2 - Call the helper during headshot replacement

Modify:

- [src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts](/C:/Users/tim/projects/snapconsent-lite/src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts)

Change:

- after successfully replacing the headshot link, clear suppressions for the consent
- then keep the existing `consent_headshot_ready` enqueue behavior

Effect:

- replacing a headshot becomes a fresh rematch for that consent

### Step 3 - Add a focused matcher test

Modify:

- [tests/feature-011-real-face-matcher.test.ts](/C:/Users/tim/projects/snapconsent-lite/tests/feature-011-real-face-matcher.test.ts)

Add coverage:

- manual unlink creates suppression
- suppression reset helper clears it for the consent
- after a replacement-style reset, rerunning a high-confidence matcher can create an auto link again

## Files To Modify

- [src/lib/matching/consent-photo-matching.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/consent-photo-matching.ts)
- [src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts](/C:/Users/tim/projects/snapconsent-lite/src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts)
- [tests/feature-011-real-face-matcher.test.ts](/C:/Users/tim/projects/snapconsent-lite/tests/feature-011-real-face-matcher.test.ts)

## Verification

1. `npm run lint`
2. `npm test`
3. Confirm:
   - normal manual unlink still creates suppression
   - headshot replacement path clears suppressions for the consent
   - worker can auto-link above-threshold pairs again after replacement
