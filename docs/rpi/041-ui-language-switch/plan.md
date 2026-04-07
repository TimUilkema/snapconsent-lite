# Feature 041 Plan: UI Language Switch (NL / EN)

## Goal

Add a Dutch/English UI language switch with Dutch (`nl`) as the default, while translating UI text only and keeping routing/auth/data behavior as unchanged as possible.

This plan follows `docs/rpi/041-ui-language-switch/research.md` as the source of truth.

## Recommendation

Implement localization with `next-intl` using cookie-driven locale on existing non-locale URLs.

- Locales: `nl`, `en`
- Default locale: `nl`
- Persistence: cookie
- URL strategy: unchanged (`/login`, `/dashboard`, `/projects`, `/templates`, `/i/:token`, `/r/:token`)
- Scope: UI text only, no stored content translation

## 1. Inputs and ground truth

### Current inline UI text situation

- UI copy is mostly inline literals across server/client components.
- There is no central translation catalog.
- Minor local constants exist (for example in login/nav), but not reusable app-wide.

### Current non-locale route structure

- App uses plain routes without locale prefixes.
- Auth redirects and path helpers assume these routes directly.
- Public token flows are fixed at `/i/[token]` and `/r/[token]`.

### Middleware/session reality

- `middleware.ts` only delegates to Supabase session refresh (`updateSession`).
- No locale detection, rewrite, or locale redirect logic exists today.

### Current error message flow

- APIs return `{ error, message }` via `HttpError` + `jsonError`.
- Many clients display `payload?.message` directly, which is currently English.

### Current stored consent/template/legal text flow

- Consent/template text is read from DB and rendered in UI:
  - `invite.consent_text`
  - `consent.consent_text`
  - template `body`
- This content is domain data and must stay as-stored.

### Explicit boundary

Feature 041 is UI localization only.

Out of scope translation targets:

- consent template content/body
- signed consent snapshot text
- DB-stored consent text in forms/project details
- user-entered content (names, emails, project names, filenames, descriptions)
- email templates, receipts, PDFs
- legal/business/domain text in DB

## 2. Verified current boundary

### Keep unchanged

- Non-locale URLs and route structure.
- Auth/session semantics and redirects.
- Public invite/revoke token flow semantics.
- Stored consent/template/legal content rendering.
- User-entered DB content rendering.
- Tenant/auth/security logic and data scoping behavior.

### Change in this feature

- Centralized UI text sourcing via translation keys.
- Locale resolution and persistence.
- Language switch UI in shared shells.
- Localized error rendering strategy on client side.
- Locale-aware date/time formatting in UI surfaces that already show dates/times.

## 3. Options considered

### Locale handling options

#### A. Cookie-only locale with non-locale URLs

Pros:

- smallest routing impact
- compatible with current redirect/path helpers
- easiest incremental rollout

Cons:

- locale not explicit in URL

Assessment:

- recommended

#### B. Locale-in-path (`/nl/...`, `/en/...`)

Pros:

- explicit locale in URL

Cons:

- broad churn in links, redirects, middleware, and token-path handling
- larger migration and regression risk

Assessment:

- reject for this feature

#### C. Hybrid cookie + locale path

Pros:

- explicit URLs plus persistence

Cons:

- unnecessary complexity for current scope

Assessment:

- reject for this feature

### Translation library options

#### A. `next-intl`

Pros:

- App Router support for server/client components
- clean message loading and translation hooks
- maintainable for future growth

Cons:

- adds dependency and initial setup

Assessment:

- recommended

#### B. Manual dictionary approach

Pros:

- no dependency

Cons:

- custom plumbing burden
- more chance of inconsistent patterns over time

Assessment:

- reject for this feature

## 4. Chosen architecture

### Core decisions

- Supported locales: `nl`, `en`
- Default locale: `nl`
- Locale persistence: cookie (for example `ui_locale`)
- URL strategy: keep existing non-locale URLs
- Translation library: `next-intl`
- Message source: repository JSON files:
  - `messages/nl.json`
  - `messages/en.json`

### Locale resolution

- Resolve locale server-side from cookie.
- If cookie missing or invalid, use `nl`.
- Only allow known values (`nl`, `en`).
- Locale is UI preference only and must not influence authorization/data access logic.

### Server/client exposure

- Root app localization setup loads messages for resolved locale.
- Server components use server-side translation helpers.
- Client components use `next-intl` client hooks.

### Route preservation during switching

- Language switch action writes locale cookie and refreshes current route.
- No route prefixing or route replacement required.
- User remains on the same page after switching.

### Default-cookie write behavior

Bounded decision:

- do not write default locale in middleware.
- use app-level resolution (`nl` fallback) and only write cookie when user explicitly switches language.

Reason:

- avoids middleware complexity and redirect loop risk
- keeps existing Supabase middleware behavior untouched

## 5. Scope boundary enforcement

### Hard rule

Only wrap UI chrome/copy in translation keys. Never localize stored domain content values.

### Explicit raw/stored values to keep unchanged

- `invite.consent_text`
- `consent.consent_text`
- template `body`
- all user-entered DB values (names/emails/project titles/descriptions/file names)

### Main code paths to protect from accidental translation

- `src/app/i/[token]/page.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/templates/template-detail-client.tsx`
- template service-backed template CRUD pages/components

Implementation guardrail:

- translate only surrounding labels/buttons/messages; render DB content values as-is.

## 6. Translation source structure

### Message file shape

Use namespaced JSON per locale (not flat one-level keys) to keep files manageable:

- `messages/nl.json`
- `messages/en.json`

Top-level groups:

- `common`
- `nav`
- `home`
- `login`
- `dashboard`
- `projects`
- `templates`
- `publicInvite`
- `publicRevoke`
- `errors`
- `validation`

### Key naming convention

- dot-path keys grouped by feature/surface, e.g.:
  - `nav.dashboard`
  - `login.submit`
  - `projects.assets.empty`
  - `errors.invalid_body`

### Future spreadsheet compatibility

Keep keys stable and deterministic so later tooling can map:

- `key | en | nl | notes`

No spreadsheet import/export tooling in Feature 041.

## 7. Locale switch UX

### Component behavior

- Use a simple `NL` / `EN` segmented toggle (or compact dropdown if shell constraints require).
- On change:
  - set locale cookie
  - refresh current route in place

### Placement

- Protected shell: include switch in `src/app/(protected)/layout.tsx` header action row near account/sign-out controls.
- Public shell/pages: include switch in top area for:
  - `src/app/page.tsx`
  - `src/app/login/page.tsx`
  - `src/app/i/[token]/page.tsx`
  - `src/app/r/[token]/page.tsx`

### Persistence

- Persist selection in cookie only (no DB preference in this feature).
- Missing cookie defaults to `nl`.

## 8. Error and validation localization

### Strategy decision

Use error-code mapping for user-facing localized messages.

- Prefer localized text derived from `payload.error`.
- Treat `payload.message` as fallback/debug text, not primary UI copy.

### Current response compatibility

Existing API shape `{ error, message }` remains unchanged.

Client rendering policy:

1. if `error` code maps to translation key, show localized message
2. else show localized generic fallback (for example `errors.generic`)
3. optionally surface raw `message` only in low-prominence fallback paths where needed for diagnostics

### Validation text

- Move client validation strings and inline form validation copy into translation keys.
- Keep domain values shown in those messages unchanged.

## 9. Affected layouts, pages, and components

### Included first-pass surfaces

- Root/home page (`src/app/page.tsx`)
- Login page (`src/app/login/page.tsx`)
- Protected layout (`src/app/(protected)/layout.tsx`)
- Protected nav (`src/components/navigation/protected-nav.tsx`)
- Dashboard/projects/templates shells:
  - `src/app/(protected)/dashboard/page.tsx`
  - `src/app/(protected)/projects/page.tsx`
  - `src/app/(protected)/projects/[projectId]/page.tsx`
  - `src/app/(protected)/templates/page.tsx`
  - `src/app/(protected)/templates/[templateId]/page.tsx`
- Public token pages:
  - `src/app/i/[token]/page.tsx`
  - `src/app/r/[token]/page.tsx`
- Shared high-traffic components used by those pages:
  - project forms/panels in `src/components/projects/*`
  - template forms/detail components in `src/components/templates/*`
  - `src/components/public/public-consent-form.tsx`

### Rollout scope decision

Bounded but complete for currently shipped UI surfaces in this app shell.

- Do not defer major pages.
- Allow minor straggler copy cleanup as a final polish pass, not as a separate redesign.

## 10. Date/time and formatting policy

### Decision

Visible date/time UI should follow selected locale (`nl`/`en`) where dates are already rendered.

### Bounded implementation policy

- Introduce shared formatting helper(s) that accept resolved locale.
- Replace direct `toLocaleString()` / `toLocaleDateString()` usage in UI surfaces with locale-aware helper calls.
- Keep format style simple and consistent; do not introduce a broad timezone/calendar refactor.

### SSR/CSR consistency

- Use the same resolved locale source (cookie -> validated locale) for both server-rendered and client-rendered formatting to avoid hydration mismatch drift.

## 11. Middleware and persistence behavior

### Middleware role

Keep `middleware.ts` focused on Supabase session maintenance only.

- No locale redirects.
- No default locale cookie writes in middleware.

### Locale setup location

- Locale resolution and message loading happen in app-level layout/i18n config.
- Locale cookie is written by explicit language-switch interaction.

### Compatibility goal

- Maintain existing middleware matcher/auth behavior.
- Avoid redirect loops and avoid auth regressions.

## 12. Security and reliability

- Locale must never affect tenant resolution.
- Locale must never affect authorization decisions.
- Locale is non-sensitive UI preference input only.
- Public token flows remain token-driven and secure.
- Login/logout/session refresh paths remain behaviorally unchanged.
- Locale resolution must be deterministic and validated (`nl|en`) for SSR/CSR.
- No service-role or secrets exposed to client as part of localization.

## 13. Edge cases

- Missing locale cookie: use `nl`.
- Invalid locale cookie: ignore and use `nl`.
- Switching locale on public token pages: preserve same token route and token semantics.
- Switching locale while authenticated: stay on same protected route, no forced re-auth.
- Mixed content pages: translated UI chrome surrounding raw DB content (consent/template text) remains expected.
- Unknown API error code: show localized generic fallback.
- Partially migrated component during rollout: must not crash; fall back to safe existing copy until migrated.
- Client/server locale mismatch risk: resolve locale from same validated source and keep message loading deterministic.

## 14. Testing plan

### Unit/integration coverage

- Locale resolution:
  - missing cookie -> `nl`
  - invalid cookie -> `nl`
  - valid `en` cookie -> `en`
- Language switch behavior:
  - writes cookie
  - preserves current route
  - translated text updates after refresh/navigation
- Shared shell localization:
  - protected layout labels/nav actions/localized strings
  - public shell/page labels
- Public invite/revoke localization:
  - UI chrome translated
  - stored consent/template text remains unchanged
- Error localization:
  - known `error` code -> localized mapped message
  - unknown `error` -> localized generic fallback
- Auth/session compatibility:
  - login/logout redirects still work
  - middleware session refresh unaffected by locale behavior
- Formatting:
  - date/time render follows selected locale on migrated surfaces

### Manual verification checklist

- Browse app with no cookie: UI appears in Dutch.
- Toggle to English on protected page, refresh, navigate: remains English.
- Toggle on invite/revoke pages: page stays on same token route.
- Confirm consent/template body text and user-entered fields are not translated or altered.

## 15. Implementation phases

### Phase 1: i18n foundation

- Add `next-intl` dependency and minimal App Router setup.
- Add locale model (`nl|en`), cookie resolver, default fallback (`nl`).
- Add `messages/nl.json` and `messages/en.json` scaffolds.
- Add minimal shared translation helper conventions.

### Phase 2: shared shells + language switch

- Localize root/login/protected shell copy.
- Localize protected navigation labels.
- Implement language switch component and cookie write flow.
- Add switch to protected and public shells.

### Phase 3: high-traffic pages/components

- Localize dashboard/projects/templates pages and shared components.
- Localize public invite/revoke UI chrome and form labels.
- Enforce boundary: keep DB-stored consent/template content raw.
- Add locale-aware date/time helper and migrate existing date displays.

### Phase 4: error/validation localization cleanup

- Introduce shared error-code -> message-key mapping utility.
- Update key client surfaces to prefer localized error mapping over raw `message`.
- Keep generic localized fallback for unknown codes.

### Phase 5: regression coverage and polish

- Add/expand tests from section 14.
- Sweep remaining visible UI literals on included surfaces.
- Confirm no auth/middleware/session regressions.

## 16. Scope boundaries

Feature 041 does not include:

- translating consent template/body/legal text
- translating signed consent snapshot text
- translating user-entered DB content
- translating emails, receipts, or PDFs
- locale-in-path routing migration
- spreadsheet translation tooling
- broader content-localization program
- unrelated routing/auth/security redesign

## Concise implementation prompt

Implement Feature 041 using `next-intl` with locales `nl` and `en`, Dutch default, and cookie-driven locale persistence on existing non-locale URLs. Localize only UI text (labels, buttons, navigation, statuses, empty states, validation/error UX copy) across root/login/protected/public invite/revoke surfaces, while keeping DB-stored consent/template/legal/user-entered content unchanged. Add a simple language switch in shared public/protected shells that preserves the current route, keep middleware/auth behavior unchanged, localize user-facing errors via `error` code mapping with generic fallback, and add tests for default locale, switching persistence, public/protected rendering, boundary enforcement, error mapping, and auth/session compatibility.
