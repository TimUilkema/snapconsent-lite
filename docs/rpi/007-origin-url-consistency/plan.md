# 007 Origin URL Consistency - Plan

## Decisions
1. Internal redirects/navigation use relative paths only.
2. Shareable invite links use path-based API payloads (`invitePath`) and are converted to absolute URLs in the browser via `window.location.origin`.
3. Email/external links use server-side `APP_ORIGIN` as canonical public origin.
4. Idempotency payloads remain origin-agnostic (store invite identity/path data, never absolute URL).
5. Temporary compatibility is supported during rollout by accepting both `inviteUrl` and `invitePath` in client parsing.

## Step-by-step execution plan
1. Add URL helper utilities.
- Create `src/lib/url/paths.ts`.
- Add `buildInvitePath(token: string): string` and `buildRevokePath(token: string): string`.
- Create `src/lib/url/external-origin.ts`.
- Add `getExternalOrigin(): string` that reads/validates `APP_ORIGIN` and normalizes trailing slash.
- Add `buildExternalUrl(path: string): string`.
- Optional: create `src/lib/http/redirect-relative.ts` for shared relative redirect responses.

2. Convert internal redirect routes to relative path redirects only.
- Modify `src/app/i/[token]/consent/route.ts`.
- Replace `new URL(..., request.url)` redirect builder with relative `Location` header redirects.
- Modify `src/app/r/[token]/revoke/route.ts`.
- Same change as consent route.
- Keep existing auth routes (`src/app/auth/login/route.ts`, `src/app/auth/logout/route.ts`) aligned with shared helper if added.

3. Move email revoke URL generation to `APP_ORIGIN`.
- Modify `src/app/i/[token]/consent/route.ts`.
- Replace `new URL(request.url).origin` usage for receipt links with `buildExternalUrl(buildRevokePath(token))`.
- No changes required in `src/lib/email/send-receipt.ts` and `src/lib/email/templates/consent-receipt.ts` beyond existing `revokeUrl` input contract.

4. Change invite API/idempotency response shape to path-based.
- Modify `src/lib/idempotency/invite-idempotency.ts`.
- Remove `origin` from `CreateInviteInput`.
- Replace `inviteUrl` output with `invitePath`.
- Ensure idempotency replay returns same `invitePath` deterministically.
- Modify `src/app/api/projects/[projectId]/invites/route.ts`.
- Stop deriving origin from `request.url`.
- Pass only tenant/project/idempotency/template inputs.
- Return payload with `invitePath` (and keep `inviteUrl` temporarily for compatibility if needed).

5. Remove server-side host/origin construction from project page.
- Modify `src/app/(protected)/projects/[projectId]/page.tsx`.
- Remove `headers()` host/proto logic and localhost fallback.
- Build invite path using shared path helper and pass path data to UI components.

6. Update invite UI components for browser-origin URL construction.
- Modify `src/components/projects/create-invite-form.tsx`.
- Update response type to include `invitePath`.
- Preserve backward compatibility: if `invitePath` missing but `inviteUrl` present, derive path from URL once during transition.
- Modify `src/components/projects/invite-actions.tsx`.
- Accept `invitePath` (or normalized absolute URL prop prepared by parent).
- Build final share URL client-side with `window.location.origin`.
- Use computed URL consistently for:
- `href` on “Fill in form here”
- QR code payload
- copied/displayed value.

7. Environment and documentation updates.
- Update `.env.example` to include `APP_ORIGIN` example values:
- local/LAN testing (explicit host),
- production (`https://app.snapconsent.com`).
- Update `README.md` with:
- guidance on localhost vs LAN behavior,
- requirement to set `APP_ORIGIN` for external links.
- Optionally update relevant RPI docs that mention `inviteUrl` response shape.

## Route and response shape changes
1. `POST /api/projects/[projectId]/invites`
- Current: `{ inviteId, inviteUrl, expiresAt, ... }`
- Target: `{ inviteId, invitePath, expiresAt, ... }`
- Transition window: may include both fields; `invitePath` is authoritative.

2. Internal POST redirect routes (`/i/[token]/consent`, `/r/[token]/revoke`)
- Behavior: return relative redirect locations only.
- No absolute host should be generated server-side.

## Edge cases and handling
1. Desktop on `http://localhost:3000`.
- Share URLs built in-browser remain localhost by design.
- Document that localhost links are not phone-shareable.

2. LAN testing on phone (`http://192.168.x.x:3000`).
- Share URLs built in-browser use LAN host automatically.
- Internal redirects remain on same host due to relative locations.

3. Production (`https://app.snapconsent.com`).
- Browser-generated share URLs use production origin.
- Email revoke links use `APP_ORIGIN` and are stable behind proxies.

4. Idempotency replay responses.
- Replays return `invitePath`, avoiding stale host from previous context.
- Keeps retry behavior deterministic and host-agnostic.

5. Temporary compatibility.
- Client tolerates both `invitePath` and legacy `inviteUrl` until all callers are migrated.
- Remove legacy parsing after rollout validation.

## Security considerations
1. No tenant/project scoping changes; all existing server-side derivation remains unchanged.
2. No client trust added for security-sensitive values; client-side origin use is only for UI share link rendering.
3. `APP_ORIGIN` validation should reject malformed or unsafe values.
4. Avoid logging full external URLs with sensitive tokens where unnecessary.

## Verification checklist
1. Desktop localhost auth flow:
- login/logout redirects remain on localhost and do not switch host unexpectedly.

2. Desktop LAN flow:
- open app with LAN host; create invite; “Fill in form here” uses LAN host.

3. Mobile LAN flow:
- open dashboard from phone; create invite; link/QR opens on phone without redirect to localhost.

4. Consent and revoke route redirects:
- POST submit/revoke keep current host and only change path/query.

5. Email revoke link correctness:
- receipt email contains URL rooted at configured `APP_ORIGIN`, not request-derived host.

6. Idempotency behavior:
- repeating invite create with same `Idempotency-Key` returns same `invitePath`.

7. Repository scan check:
- no remaining server-side app URL construction with localhost fallback for app links.
- no server code still deriving app share URLs from `request.url` origin.

