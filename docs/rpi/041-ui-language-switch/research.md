# Feature 041 Research: UI Language Switch (NL / EN)

## Goal

Research a bounded approach to add Dutch/English UI localization to the web app with:

- Dutch (`nl`) as default
- user-switchable language
- UI text localization only
- no redesign of core routing/auth/data behavior

This is research only. No implementation changes are proposed in this document.

## Inputs reviewed

Required docs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`

App structure, layout, middleware, auth/session:

- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/login/page.tsx`
- `src/app/(protected)/layout.tsx`
- `src/components/navigation/protected-nav.tsx`
- `middleware.ts`
- `src/lib/supabase/middleware.ts`
- `src/lib/supabase/server.ts`
- `src/app/auth/login/route.ts`
- `src/app/auth/logout/route.ts`

Public/protected page structure and key UI surfaces:

- `src/app/i/[token]/page.tsx`
- `src/app/r/[token]/page.tsx`
- `src/app/(protected)/dashboard/page.tsx`
- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/(protected)/templates/page.tsx`
- `src/app/(protected)/templates/[templateId]/page.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/components/projects/*.tsx`
- `src/components/templates/*.tsx`

Path/link/redirect helpers:

- `src/lib/url/paths.ts`
- `src/lib/http/redirect-relative.ts`
- `src/lib/url/external-origin.ts`

Error shaping and display surfaces:

- `src/lib/http/errors.ts`
- API routes under `src/app/api/**`
- Client components reading `payload?.message` in `src/components/**`

Consent/template text flow (scope-boundary validation):

- `src/app/i/[token]/page.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/lib/consent/submit-consent.ts`
- `src/lib/consent/constants.ts`
- `src/components/templates/template-create-form.tsx`
- `src/components/templates/template-detail-client.tsx`
- `src/lib/email/templates/consent-receipt.ts`

Dependency/docs check:

- `package.json`
- `docs/**` (scan for i18n/localization references)

## Verified current behavior

## 1. Current state

### UI text storage/rendering today

- UI text is mostly inline string literals inside pages/components.
- Small local constants exist (`ERROR_MESSAGES` in login page, `NAV_ITEMS` in protected nav, `STATUS_STYLES` label usage in template status badge), but there is no app-wide message catalog.
- There is no shared translation function/provider today.

### Where text is concentrated first

Highest-impact surfaces are:

- app chrome and navigation:
  - `src/app/(protected)/layout.tsx`
  - `src/components/navigation/protected-nav.tsx`
  - `src/app/page.tsx`
  - `src/app/login/page.tsx`
- public consent/revoke surfaces:
  - `src/app/i/[token]/page.tsx`
  - `src/components/public/public-consent-form.tsx`
  - `src/app/r/[token]/page.tsx`
- project dashboard/workflow components:
  - `src/app/(protected)/dashboard/page.tsx`
  - `src/app/(protected)/projects/page.tsx`
  - `src/app/(protected)/projects/[projectId]/page.tsx`
  - `src/components/projects/*.tsx`
- template management:
  - `src/app/(protected)/templates/*.tsx`
  - `src/components/templates/*.tsx`

### Existing i18n/localization libraries

- No i18n library is installed.
- `package.json` has no `next-intl`, `react-intl`, `i18next`, etc.
- No existing `messages/*.json`, locale directories, or i18n docs were found.

## 2. App structure and routing

### Current routing shape

- App Router with no locale segment:
  - `/`, `/login`, `/dashboard`, `/projects`, `/templates`, etc.
  - public invite/revoke token routes: `/i/[token]`, `/r/[token]`
- Auth redirects and helper paths assume non-locale URLs:
  - `redirect("/login")`, `redirect("/dashboard")`, etc.
  - `buildInvitePath(token) => /i/:token`
  - `buildRevokePath(token) => /r/:token`
  - `redirectRelative` expects explicit relative paths

### Middleware/session behavior

- `middleware.ts` currently only runs Supabase `updateSession`.
- No locale detection/rewrites/cookie behavior exists.
- Locale does not currently influence auth/session behavior.

### Implications for localization approaches

- Locale-in-path (`/nl/...`, `/en/...`) would require broad updates:
  - all links/navigation
  - redirects in server pages and route handlers
  - invite/revoke path builders and external link generation
  - likely middleware redirects/rewrites
- Cookie-based locale with current non-locale URLs avoids this route churn.

## 3. Library choice

Options evaluated:

1. `next-intl`
- Pros:
  - strong App Router support
  - server + client translation hooks
  - scalable for more languages later
  - structured message loading
- Cons:
  - adds dependency and integration setup
  - introduces framework concepts that are heavier than a tiny manual helper

2. Manual/native dictionary pattern (JSON + typed helper/context)
- Pros:
  - smallest runtime surface
  - no new dependency
  - easy to align to UI-only scope and incremental rollout
- Cons:
  - custom plumbing for server/client message access
  - easier to drift in quality without conventions

3. Other alternatives
- No existing repo fit justified another option over the above two.

### Recommended bounded choice

Recommend `next-intl` with non-locale URLs (cookie/default-locale driven), not locale path prefixes.

Reasoning:

- Best balance of maintainability + App Router compatibility
- Avoids broad routing migration
- Gives robust translation primitives for both server and client components
- Leaves clean room for future translation source tooling without custom framework work

## 4. Scope boundary: UI text only

This boundary is critical and should be explicit in implementation:

### Must stay untranslated (as stored content)

- consent template content/body
- signed consent snapshot text
- consent text displayed from DB in invite/project detail pages
- user-entered fields (project names, descriptions, filenames, names, emails)
- legal/business data persisted in DB
- receipt/PDF/email content (out of this feature scope)

### Verified code paths where stored consent/template text enters UI

- `src/app/i/[token]/page.tsx` passes `invite.consent_text` into UI
- `src/components/public/public-consent-form.tsx` renders `consentText` directly
- `src/app/(protected)/projects/[projectId]/page.tsx` renders `consent?.consent_text`
- template CRUD pages/components display/edit template `body` values from DB

These should remain raw stored content and not be wrapped in UI translation calls.

## 5. Translation source strategy

Options evaluated:

1. Repo JSON runtime source (`messages/nl.json`, `messages/en.json`)
- Lowest-risk start
- easy PR review
- straightforward key-based usage

2. Spreadsheet/CSV as canonical source immediately
- Better for non-dev editing later
- Adds tooling/mapping complexity now

3. Hybrid now/later
- Runtime JSON now
- optional script later for `key | en | nl | notes` import/export

### Recommended bounded start

- Use runtime JSON files in repo as source of truth for this feature.
- Keep key naming and file structure compatible with future spreadsheet sync, but do not build spreadsheet tooling in Feature 041.

## 6. Language switch UX

### Placement

- Put a language switch in shared layouts:
  - protected layout header (`src/app/(protected)/layout.tsx`)
  - public layout surfaces (root or shared public header area)
- Keep switch visible but lightweight; no modal/settings detour required.

### Persistence

- Persist selected locale in a cookie (e.g. `ui_locale`).
- Default when cookie missing: `nl`.
- Keep URLs unchanged.

### Route preservation

- Switching language should keep the current route and refresh translated UI text in place.

### Public/protected behavior

- Both public and protected pages should respect locale cookie.
- Auth/session flows should not depend on locale and should continue unchanged.

## 7. Error messages and validation text

### Current state

- APIs return `{error, message}` via `HttpError/jsonError`.
- Many clients render `payload?.message` directly, with local English fallbacks.
- There is no shared client mapping from `error` code to localized display text.

### Recommended direction

- Prefer localized client mapping by error code for user-facing UI.
- Treat server `message` as fallback/debug, not primary localized UX copy.
- Keep server error codes stable (`invalid_body`, `unauthenticated`, etc.).

This avoids forcing route handlers to carry multilingual message payloads and keeps localization concerns in UI.

## 8. Permissions / security / tenant concerns

Verified invariants for this feature:

- Locale must not influence tenant resolution or authorization.
- Locale input is non-sensitive UI preference only.
- Client-provided locale must not be used for security decisions.
- Auth/session middleware and server Supabase calls remain unchanged in semantics.
- Public token flows (`/i/[token]`, `/r/[token]`) remain token-driven and secure; locale only affects displayed UI strings.

## 9. Compatibility and migration

### Smallest migration shape

- Add localization infrastructure first (message loading, locale resolution, switch).
- Migrate high-visibility shared surfaces first:
  - root/protected layout/nav
  - login/home
  - invite/revoke pages
- Then migrate major shared components (`projects/*`, `templates/*`) incrementally.

### Why not one-shot rewrite

- Text is spread widely in inline literals.
- One-shot translation would be high-risk and hard to review.
- Incremental migration can be merged safely while maintaining behavior.

### Route/link safety

- Keeping non-locale URLs avoids widespread link and redirect changes.
- No broad route migration required for Feature 041.

## 10. Future extensibility (not current scope)

Architecture should leave room for:

- spreadsheet-driven translation management later (`key | en | nl | notes`)
- additional locales
- optional per-user locale preference persistence in DB (later)
- localized email templates later
- localized consent-template authoring later (if product decides), separate from Feature 041

None of the above should be implemented in this feature.

## Current constraints and invariants

- Translate UI text only.
- Do not translate DB-stored consent/template/legal content.
- Keep business logic and security logic server-side and locale-agnostic.
- Preserve current non-locale route structure unless absolutely necessary.
- Keep changes bounded and reviewable.

## Options considered

## A. Locale in URL path (`/nl/...`, `/en/...`)

Pros:

- explicit, shareable locale in URL

Cons:

- broad route and helper churn in this codebase
- token/public link builders and redirects must be revised
- higher migration risk

Assessment: not the cleanest bounded fit for this repo right now.

## B. Cookie/session locale with non-locale URLs

Pros:

- minimal routing disruption
- works with current auth/redirect/path helpers
- easiest bounded rollout

Cons:

- locale not explicit in URL by default

Assessment: best fit for current architecture and scope.

## C. Hybrid URL + cookie

Pros:

- explicit URLs plus persistence

Cons:

- complexity beyond current need

Assessment: over-scoped for Feature 041.

## Recommended bounded direction

- Implement UI localization with Dutch default via cookie-driven locale (non-locale URLs).
- Use `next-intl` for maintainable App Router localization primitives.
- Store runtime messages in repo JSON (`messages/nl.json`, `messages/en.json`).
- Add a shared language switch in public + protected layouts that preserves current route.
- Migrate UI copy incrementally by keys.
- Keep consent/template/legal/user-entered content untouched.
- Move client-facing error rendering toward localized error-code mapping instead of raw server English messages.

## Risks and tradeoffs

- Incremental rollout can leave mixed-language UI temporarily unless migration slices are carefully chosen.
- Continued use of raw `payload.message` will leak English text unless mapped/fallback strategy is applied.
- Date/time formatting (`toLocaleString`) currently relies on runtime locale defaults; language selection should align formatting behavior intentionally.
- If locale state handling is scattered, consistency across server/client renders can drift.

## Open decisions for plan phase

1. `next-intl` vs manual dictionary helper
- Research recommendation: `next-intl`.

2. Locale routing strategy
- cookie-only non-locale URLs vs path locale
- Research recommendation: cookie-only non-locale URLs.

3. Default locale handling
- middleware sets cookie vs app-level default without writing cookie
- both viable; choose minimal reliable behavior.

4. Message source structure
- flat JSON vs namespaced JSON modules
- both should support later spreadsheet sync.

5. Error localization strategy
- localize server messages directly vs client map by error code
- Research recommendation: client map by error code with localized generic fallbacks.

6. Switch placement details
- exact public header location and protected header layout interaction.

7. Rollout phasing
- whether to localize all current UI in one release or prioritize shared shells + high-traffic surfaces first.

8. Locale persistence scope
- cookie-only now vs optional DB user preference now.
- Research recommendation: cookie-only now; DB preference later if needed.

9. Date/time formatting policy
- adopt locale-aware formatting consistently where UI shows dates/times.
