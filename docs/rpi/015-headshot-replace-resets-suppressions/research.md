# 015 Headshot Replace Resets Suppressions - Research

## Goal

Change the current matching behavior so that replacing a consent headshot resets prior manual-unlink suppressions for that consent, allowing automatic facial matching to evaluate project photos again with the new headshot.

## Ground Truth

Current code behavior:

- manual photo unlink persists an exact-pair suppression row in `asset_consent_link_suppressions`
- worker skips suppressed pairs even when confidence is above threshold
- headshot replacement enqueues a new `consent_headshot_ready` job, but does not clear suppressions first

Relevant files:

- [src/lib/matching/consent-photo-matching.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/consent-photo-matching.ts)
- [src/lib/matching/auto-match-worker.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/auto-match-worker.ts)
- [src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts](/C:/Users/tim/projects/snapconsent-lite/src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts)
- [docs/rpi/011-real-face-matcher/plan.md](/C:/Users/tim/projects/snapconsent-lite/docs/rpi/011-real-face-matcher/plan.md)

## Current Problem

The current suppression model is too sticky for headshot replacement.

Example:

1. Subject gets linked to some photos.
2. User manually unlinks those photos.
3. Suppression rows are created for those exact `(asset_id, consent_id)` pairs.
4. User later replaces the headshot with a better one.
5. A new `consent_headshot_ready` job runs, but the worker still skips the suppressed pairs.

Result:

- matching runs
- good scores may still be produced
- no auto links are recreated for previously suppressed pairs

This is correct per current 011 design, but it conflicts with the desired product behavior for headshot replacement.

## Desired Behavior

When a headshot is replaced for a consent:

- keep manual links authoritative
- keep normal manual unlink suppression behavior in general
- but clear prior suppressions for that consent before rerunning matching

Effect:

- the replacement acts as a fresh matching baseline for that consent
- previously suppressed project-photo pairs can be auto-linked again if the new headshot scores above threshold

## Recommended Change

Do not remove suppression from the product entirely.

Instead:

- keep suppression on manual unlink
- clear all `asset_consent_link_suppressions` rows for the consent during headshot replacement
- then enqueue the existing `consent_headshot_ready` job

This is the smallest safe change because:

- no queue redesign is needed
- no schema change is needed
- worker logic remains unchanged
- tenant/project scoping remains server-side
- the new behavior is tightly scoped to headshot replacement only

## Risks

- Clearing suppressions for the whole consent means a user’s earlier manual rejection of specific photo pairs is intentionally discarded once the headshot changes.
- This is acceptable because the headshot change is explicitly the user signal that the matching baseline has changed and a fresh automatic pass is desired.

## Recommendation

Implement a small server-side helper that clears all photo-pair suppressions for a consent, call it from the headshot replacement route, and add a focused test proving that:

- manual unlink still creates suppression
- headshot replacement clears suppression
- a rerun can auto-link above-threshold matches again
