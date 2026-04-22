# Feature 066 Plan: Post-Finalize Matching Job Enqueue Reliability

## Goal

Ensure newly finalized project photos reliably enqueue matching/materialization work so they do not remain stuck in `Pending materialization` without a queued job.

## Implementation plan

1. Update `src/lib/assets/post-finalize-processing.ts`.
2. Keep derivative queue behavior unchanged.
3. Create an admin Supabase client for matching-related follow-up work.
4. Use that admin client for:
   - `getCurrentConsentHeadshotFanoutBoundary(...)`
   - `getCurrentProjectRecurringSourceBoundary(...)`
   - `enqueuePhotoUploadedJob(...)`
5. Preserve the current non-fatal finalize behavior, but log matching enqueue failures with tenant/project/asset context.
6. Add a focused test that proves post-finalize matching enqueue uses the admin client boundary instead of silently depending on the request-scoped user client.
7. Run targeted tests/lint.
8. Backfill already-missed assets operationally by:
   - calling the matching repair endpoint for affected project ids
   - draining the matching worker
   - verifying `asset_face_materializations` rows exist for the previously pending assets

## Security considerations

- Do not trust tenant or project scope from the client.
- Reuse the already validated finalize scope and only elevate the internal post-finalize enqueue step.
- Keep the service-role key server-side only.

## Reliability considerations

- Finalize remains retry-safe and should still succeed even if downstream enqueue fails.
- Logging must make future enqueue failures diagnosable.
- Existing missed jobs require repair because the code fix is not retroactive.

## Testing

- Targeted unit/integration coverage around post-finalize scheduling.
- Manual verification by backfilling current pending assets and confirming materialization status changes.
