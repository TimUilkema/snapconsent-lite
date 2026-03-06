# SnapConsent Lite

Minimal Next.js + Supabase app for consent workflows.

## Setup

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local` and fill values.
3. Start Supabase local stack.
4. Run app:
   `npm run dev`

## URL Origin Configuration

- Internal app redirects use relative paths and stay on the current host.
- Share links in the UI are built from the browser host (`window.location.origin`) plus invite path.
- External links in emails use `APP_ORIGIN`.

Set `APP_ORIGIN` in `.env.local`:

- Desktop-local only: `APP_ORIGIN=http://localhost:3000`
- LAN/mobile testing: `APP_ORIGIN=http://192.168.2.9:3000`
- Production: `APP_ORIGIN=https://app.snapconsent.com`

Note: Links created while browsing `http://localhost:3000` are not phone-shareable. For cross-device testing, open the app on desktop with the LAN host/IP.

## Mobile Uploads In Local Dev

Signed storage upload URLs can be generated with loopback hosts (for example `127.0.0.1`).  
The app normalizes loopback signed upload URLs to the current browser host for LAN/mobile testing.

Recommended local setup for phone testing:
- Open app via LAN host, not `localhost`.
- Set `APP_ORIGIN` to the same LAN host.
- If needed, set `NEXT_PUBLIC_SUPABASE_URL` to a LAN-reachable Supabase API host/port.

## Core Auth Flow

- Login: `/login`
- Protected dashboard: `/dashboard`
- Projects area: `/projects`

## Projects + Invites Flow (002)

1. Create a project at `/projects`.
2. Open project dashboard and create an invite URL.
3. Share invite URL (QR-safe).
4. Subject opens invite URL, submits consent form.
5. Receipt email is sent to subject with revoke link.
6. Subject can revoke consent from public revoke URL.

## Local Email Verification

The local Supabase config uses Inbucket for email testing.

- Inbucket UI: `http://127.0.0.1:54324`
- SMTP target for app mailer: `127.0.0.1:54325`

After submitting consent, verify in Inbucket:
- receipt delivered to subject email
- consent summary content
- revoke link works and marks consent revoked without deleting consent records

## Validation Commands

- Reset DB and apply migrations: `supabase db reset`
- Lint: `npm run lint`
- Run app: `npm run dev`
