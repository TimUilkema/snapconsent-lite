# 007 Origin URL Consistency - Research

## Goal
Fix app-wide URL/origin handling so links and redirects work consistently on desktop, mobile, LAN, and production without hardcoding per-route absolute URLs.

## 1) URL/Origin Usage Inventory
### Internal navigation/redirect
1. `src/app/auth/login/route.ts:6-7`
- Pattern: `NextResponse.redirect(request.url)` + `Location` header set to relative path.
- Classification: internal redirect.
- Status: mostly safe (relative `Location` avoids host lock-in).

2. `src/app/auth/logout/route.ts:6-7`
- Pattern: same as login route.
- Classification: internal redirect.
- Status: mostly safe.

3. `src/app/i/[token]/consent/route.ts:20-24`
- Pattern: `new URL(\`/i/${token}\`, request.url)` then redirect.
- Classification: internal redirect.
- Risk: absolute URL inherits potentially wrong server-side origin (`localhost`).

4. `src/app/r/[token]/revoke/route.ts:19-23`
- Pattern: `new URL(\`/r/${token}\`, request.url)` then redirect.
- Classification: internal redirect.
- Risk: same as above.

### Shareable UI link
5. `src/app/api/projects/[projectId]/invites/route.ts:82,89`
- Pattern: `const origin = new URL(request.url).origin`, passed into invite creation.
- Classification: shareable link generation for UI/API response.
- Risk: server-derived origin can resolve to `localhost` in dev/LAN contexts.

6. `src/lib/idempotency/invite-idempotency.ts:18,49,57,132`
- Pattern: accepts `origin`, builds absolute `inviteUrl = ${origin}/i/${token}`.
- Classification: shareable link generation.
- Risk: bakes whichever origin server computed into response payload.

7. `src/app/(protected)/projects/[projectId]/page.tsx:127-129,251`
- Pattern: host/proto from headers with fallback `http://localhost:3000`; builds absolute invite URLs.
- Classification: shareable link generation for existing invites.
- Risk: explicit localhost fallback and header variability create wrong links.

8. `src/components/projects/create-invite-form.tsx:10,71,78,129`
- Pattern: expects `inviteUrl` (absolute) from API and passes to share panel.
- Classification: shareable UI rendering.

9. `src/components/projects/invite-actions.tsx:9,74,86`
- Pattern: uses `inviteUrl` directly for `href`, copy field, QR payload.
- Classification: shareable UI rendering.

### Email/external link
10. `src/app/i/[token]/consent/route.ts:72,82`
- Pattern: `revokeUrl = ${new URL(request.url).origin}/r/${revokeToken}` for receipt email.
- Classification: email/external URL.
- Risk: email may include `localhost` or wrong host behind proxy/rewrite.

11. `src/lib/email/send-receipt.ts` + `src/lib/email/templates/consent-receipt.ts`
- Pattern: consume provided `revokeUrl`; no origin derivation here.
- Classification: email/external URL sink.

### Dev config note
12. `next.config.ts:6`
- Pattern: `allowedDevOrigins`.
- Classification: dev server cross-origin allowance only.
- Note: helps Next dev warnings/asset access, does not solve URL construction correctness.

## 2) Current Failure Points Causing Mobile `localhost`
1. Invite link creation relies on server-side `request.url` origin (`/api/projects/[projectId]/invites`), which can resolve to `localhost` in local dev environments.
2. Existing invite link rendering in project page has explicit fallback to `http://localhost:3000`.
3. Consent/revoke POST handlers create absolute redirect targets from `request.url`, so phone flows can be bounced to `localhost`.
4. Revoke links in receipt emails are generated from `request.url` origin, which is unreliable for external recipients.
5. Multiple origin derivation methods coexist (request URL, forwarded headers, hardcoded localhost), causing inconsistent behavior across routes.

## 3) Consistent App-Wide URL Strategy
### A. Internal navigation/redirect
- Use relative paths only (e.g., `/login`, `/dashboard`, `/i/:token`, `/r/:token`).
- Do not construct absolute redirect URLs for in-app POST->redirect flows.
- Centralize in one helper that always writes relative `Location`.

### B. Shareable UI links (copy/open/QR inside browser)
- Server returns canonical path/token (`invitePath` like `/i/:token`), not absolute origin-bound URL.
- Client builds absolute URL from current browser origin (`window.location.origin + invitePath`) at render time.
- This guarantees link host matches the device/session actually using the UI.

### C. Email/external links
- Use server-side `APP_ORIGIN` env var as canonical public origin.
- Build external links as `${APP_ORIGIN}/r/:token` (and future external links similarly).
- In production, `APP_ORIGIN` should be required and validated; dev may use controlled fallback.

## 4) Exact Change Surface (for plan/implement)
1. `src/app/i/[token]/consent/route.ts`
- Replace absolute redirect builder with relative redirect helper.
- Replace revoke email URL origin derivation with shared external-origin helper (`APP_ORIGIN`).

2. `src/app/r/[token]/revoke/route.ts`
- Replace absolute redirect builder with relative redirect helper.

3. `src/app/api/projects/[projectId]/invites/route.ts`
- Stop deriving `origin` from `request.url`.
- Return path/token-based payload from invite idempotency layer.

4. `src/lib/idempotency/invite-idempotency.ts`
- Remove `origin` input.
- Return `invitePath` (or token + path helper), not absolute URL.
- Keep idempotency payload origin-agnostic.

5. `src/app/(protected)/projects/[projectId]/page.tsx`
- Remove host/proto derivation and localhost fallback.
- Pass `invitePath` to UI instead of absolute URL.

6. `src/components/projects/create-invite-form.tsx`
- Accept `invitePath` response shape.
- Build absolute URL client-side for display/QR/click actions.

7. `src/components/projects/invite-actions.tsx`
- Accept path or precomputed absolute URL from current browser origin.
- Ensure anchor/copy/QR all use browser-origin-based URL.

8. New shared helpers (recommended)
- `src/lib/url/paths.ts` for route path builders (invite path, revoke path).
- `src/lib/url/external-origin.ts` for `APP_ORIGIN` resolution/validation.
- Optional shared relative redirect utility for route handlers.

9. Env/documentation
- Add `APP_ORIGIN` to `.env.example` and relevant docs.

## 5) Edge Cases
1. Desktop `localhost` vs phone
- If UI is opened at `http://localhost:3000`, browser-origin links will still be `localhost` and are not phone-shareable by definition.
- Correct behavior: open app via LAN host (`http://192.168.x.x:3000`) when cross-device sharing/testing is needed.

2. LAN IP testing
- With browser-origin share links, links generated on phone/desktop use current LAN host automatically.
- No per-route hardcoding needed.

3. Production domain
- Internal redirects stay relative and domain-agnostic.
- Email/external links always use `APP_ORIGIN` (stable public domain), independent of internal proxy host headers.

4. Idempotency replay responses
- If responses include absolute URLs, replay can return host-inconsistent links.
- Path-based response (`invitePath`) avoids stale absolute host leakage and remains retry-safe.

5. Legacy payload compatibility
- Transition period may need temporary support for both `inviteUrl` and `invitePath` in client parsing to avoid breakage during rollout.

