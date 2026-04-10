# Deployment Guide

This document describes the simplest practical demo deployment for this repository, based on the code and runtime behavior currently present in the repo.

It is intentionally optimized for:

- one Ubuntu 24 VPS
- one simple demo/dev showcase deployment
- secrets kept server-side
- minimal moving parts

It is not a production hardening guide.

## Recommended simple demo deployment

Use this deployment model:

- Next.js app on the VPS, running `npm run dev` under `systemd`
- hosted Supabase for Auth + Postgres + Storage
- self-hosted CompreFace on the same VPS with Docker Compose
- `systemd` timers that call this repo's internal worker endpoints over `http://127.0.0.1:3000`

Why this is the simplest viable setup for this repo:

- The app is tightly coupled to Supabase Auth, Postgres RPCs/RLS, and Storage.
- The real face-matching path is implemented against CompreFace HTTP APIs.
- The repo does not define a separate worker service binary; background work is done through internal HTTP endpoints.
- `npm run build` currently fails in this repo, so the simplest setup that works today is `next dev`, not `next start`.

Current build failure:

- [src/components/templates/template-structured-fields-editor.tsx:265](C:/Users/tim/projects/snapconsent-lite/src/components/templates/template-structured-fields-editor.tsx#L265)

## What is required

You need:

- one Ubuntu 24 VPS
- one hosted Supabase project
- one GitHub SSH key configured on the VPS
- Docker and Docker Compose plugin on the VPS
- Node installed on the VPS
- one Supabase Auth user for app login
- one CompreFace application
- one CompreFace `DETECTION` service API key
- one CompreFace `VERIFICATION` service API key

Required secrets:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INVITE_TOKEN_SECRET`
- `MATCHING_WORKER_TOKEN`
- `MATCHING_RECONCILE_TOKEN`
- `ASSET_DERIVATIVE_WORKER_TOKEN`
- `ASSET_DERIVATIVE_REPAIR_TOKEN`

Optional secrets:

- `MATCHING_REPAIR_TOKEN`
- `HEADSHOT_CLEANUP_TOKEN`

Optional config:

- `APP_ORIGIN`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_FROM`

Not required for this demo:

- DNS/domain
- nginx
- self-hosted Supabase
- Redis
- RabbitMQ
- separate long-running worker process

## What the repo actually requires at runtime

### Core services

The code requires:

- Next.js app server
- Supabase Auth
- Supabase Postgres
- Supabase Storage

Repo evidence:

- Supabase browser/server clients: [src/lib/supabase/client.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/supabase/client.ts), [src/lib/supabase/server.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/supabase/server.ts)
- Service-role usage across server-only flows: [src/lib/supabase/admin.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/supabase/admin.ts)
- Storage-backed asset flows: [src/lib/assets/create-asset.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/assets/create-asset.ts)

### Face matching

Real matching is optional for a basic app demo, but required if you want the repo's current facial matching flow to work as designed.

Repo evidence:

- provider selection: [src/lib/matching/auto-matcher.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/matching/auto-matcher.ts)
- CompreFace provider: [src/lib/matching/providers/compreface.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/matching/providers/compreface.ts)
- CompreFace config/env parsing: [src/lib/matching/auto-match-config.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/matching/auto-match-config.ts)

### Email

Email is optional for the demo.

The app attempts to send consent receipt emails, but submission still succeeds if email delivery fails.

Repo evidence:

- receipt send: [src/lib/email/send-receipt.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/email/send-receipt.ts)
- failure is tolerated: [src/app/i/[token]/consent/route.ts](C:/Users/tim/projects/snapconsent-lite/src/app/i/[token]/consent/route.ts)

### Workers and background jobs

This repo uses internal HTTP endpoints, not a standalone worker process.

Repo evidence:

- matching worker: [src/app/api/internal/matching/worker/route.ts](C:/Users/tim/projects/snapconsent-lite/src/app/api/internal/matching/worker/route.ts)
- matching reconcile: [src/app/api/internal/matching/reconcile/route.ts](C:/Users/tim/projects/snapconsent-lite/src/app/api/internal/matching/reconcile/route.ts)
- matching repair: [src/app/api/internal/matching/repair/route.ts](C:/Users/tim/projects/snapconsent-lite/src/app/api/internal/matching/repair/route.ts)
- asset worker: [src/app/api/internal/assets/worker/route.ts](C:/Users/tim/projects/snapconsent-lite/src/app/api/internal/assets/worker/route.ts)
- asset repair: [src/app/api/internal/assets/repair/route.ts](C:/Users/tim/projects/snapconsent-lite/src/app/api/internal/assets/repair/route.ts)
- headshot cleanup: [src/app/api/internal/headshots/cleanup/route.ts](C:/Users/tim/projects/snapconsent-lite/src/app/api/internal/headshots/cleanup/route.ts)

## Required `.env.local`

Use this template for the recommended demo deployment:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

INVITE_TOKEN_SECRET=

AUTO_MATCH_PROVIDER=compreface
AUTO_MATCH_PIPELINE_MODE=materialized_apply
COMPREFACE_BASE_URL=http://127.0.0.1:8000
COMPREFACE_VERIFICATION_API_KEY=
COMPREFACE_DETECTION_API_KEY=

MATCHING_WORKER_TOKEN=
MATCHING_RECONCILE_TOKEN=
ASSET_DERIVATIVE_WORKER_TOKEN=
ASSET_DERIVATIVE_REPAIR_TOKEN=

# Optional manual full-project repair endpoint
# MATCHING_REPAIR_TOKEN=

# Optional receipt/revoke links via email
# APP_ORIGIN=http://YOUR_VPS_IP:3000
# SMTP_HOST=127.0.0.1
# SMTP_PORT=1025
# SMTP_FROM=receipts@example.test
```

Variable meanings:

- `NEXT_PUBLIC_SUPABASE_URL`: hosted Supabase project API URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: public anon key used by auth/session clients
- `SUPABASE_SERVICE_ROLE_KEY`: server-only admin key used by uploads, exports, workers, matching, derivatives
- `INVITE_TOKEN_SECRET`: server-side HMAC secret for invite token derivation
- `AUTO_MATCH_PROVIDER`: selects `compreface` instead of the built-in stub provider
- `AUTO_MATCH_PIPELINE_MODE`: use the current materialized matching pipeline
- `COMPREFACE_BASE_URL`: CompreFace base URL on the VPS
- `COMPREFACE_VERIFICATION_API_KEY`: used for CompreFace verification and embedding-verify calls
- `COMPREFACE_DETECTION_API_KEY`: used for CompreFace detection/materialization calls
- `MATCHING_WORKER_TOKEN`: protects the matching worker endpoint
- `MATCHING_RECONCILE_TOKEN`: protects the matching reconcile endpoint
- `ASSET_DERIVATIVE_WORKER_TOKEN`: protects the asset derivative worker endpoint
- `ASSET_DERIVATIVE_REPAIR_TOKEN`: protects the asset derivative repair endpoint

Notes about CompreFace keys:

- The repo uses a separate detection key and verification key when configured.
- If you only set `COMPREFACE_API_KEY`, the code can fall back to a shared key, but separate keys are the cleaner setup for this repo.

Repo evidence:

- CompreFace key resolution: [src/lib/matching/auto-match-config.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/matching/auto-match-config.ts)
- verification endpoints used: [src/lib/matching/providers/compreface.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/matching/providers/compreface.ts)

## Simple VPS tutorial

### 1. Install system packages

```bash
sudo apt update
sudo apt install -y git curl ca-certificates build-essential ufw docker.io docker-compose-plugin

sudo ufw allow OpenSSH
sudo ufw allow 3000/tcp
sudo ufw --force enable
```

### 2. Configure GitHub SSH on the VPS

Generate a new key on the VPS:

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
ssh-keygen -t ed25519 -C "snapconsent-vps" -f ~/.ssh/id_ed25519_github_snapconsent
cat ~/.ssh/id_ed25519_github_snapconsent.pub
```

Add the public key to GitHub, then create SSH config:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_github_snapconsent
  IdentitiesOnly yes
EOF

chmod 600 ~/.ssh/config
ssh -T git@github.com
```

### 3. Install Node with `nvm`

This repo includes `.nvmrc` and currently targets:

- [.nvmrc](C:/Users/tim/projects/snapconsent-lite/.nvmrc)

Install and use it:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"

mkdir -p ~/apps
cd ~/apps
git clone git@github.com:TimUilkema/snapconsent-lite.git
cd ~/apps/snapconsent-lite
nvm install
nvm use
npm install
```

### 4. Configure hosted Supabase

Create a hosted Supabase project, then link and push the repo migrations:

```bash
cd ~/apps/snapconsent-lite
npx supabase login
npx supabase link --project-ref YOUR_SUPABASE_PROJECT_REF
npx supabase db push
```

Then in the Supabase dashboard:

- create one Auth user with email/password
- use that user to log into the app

On first protected-page access, the repo auto-bootstraps a tenant membership:

- [src/app/(protected)/layout.tsx](C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/layout.tsx)
- [src/lib/tenant/resolve-tenant.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/tenant/resolve-tenant.ts)

### 5. Create fresh `.env.local`

```bash
cd ~/apps/snapconsent-lite

INVITE_TOKEN_SECRET=$(openssl rand -hex 32)
MATCHING_WORKER_TOKEN=$(openssl rand -hex 32)
MATCHING_RECONCILE_TOKEN=$(openssl rand -hex 32)
ASSET_DERIVATIVE_WORKER_TOKEN=$(openssl rand -hex 32)
ASSET_DERIVATIVE_REPAIR_TOKEN=$(openssl rand -hex 32)

cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY

INVITE_TOKEN_SECRET=$INVITE_TOKEN_SECRET

AUTO_MATCH_PROVIDER=compreface
AUTO_MATCH_PIPELINE_MODE=materialized_apply
COMPREFACE_BASE_URL=http://127.0.0.1:8000
COMPREFACE_VERIFICATION_API_KEY=FILL_AFTER_COMPREFACE_SETUP
COMPREFACE_DETECTION_API_KEY=FILL_AFTER_COMPREFACE_SETUP

MATCHING_WORKER_TOKEN=$MATCHING_WORKER_TOKEN
MATCHING_RECONCILE_TOKEN=$MATCHING_RECONCILE_TOKEN
ASSET_DERIVATIVE_WORKER_TOKEN=$ASSET_DERIVATIVE_WORKER_TOKEN
ASSET_DERIVATIVE_REPAIR_TOKEN=$ASSET_DERIVATIVE_REPAIR_TOKEN
EOF

chmod 600 .env.local
```

### 6. Start the app

Current repo state:

- `npm run build` fails
- therefore use `npm run dev` for the demo deployment

Manual run:

```bash
cd ~/apps/snapconsent-lite
npm run dev -- --hostname 0.0.0.0 --port 3000
```

### 7. Run the app persistently with `systemd`

Create `/etc/systemd/system/snapconsent-lite.service`:

```ini
[Unit]
Description=SnapConsent Lite demo app
After=network.target

[Service]
Type=simple
User=YOURUSER
WorkingDirectory=/home/YOURUSER/apps/snapconsent-lite
ExecStart=/bin/bash -lc 'source /home/YOURUSER/.nvm/nvm.sh && cd /home/YOURUSER/apps/snapconsent-lite && npm run dev -- --hostname 0.0.0.0 --port 3000'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now snapconsent-lite.service
sudo systemctl status snapconsent-lite.service
```

### 8. App updates

```bash
cd ~/apps/snapconsent-lite
git fetch origin
git pull --ff-only origin main
npm install
sudo systemctl restart snapconsent-lite.service
```

## CompreFace setup

### Why CompreFace is needed

If you want the real matching flow, this repo requires CompreFace.

It calls:

- `/api/v1/detection/detect`
- `/api/v1/verification/verify`
- `/api/v1/verification/embeddings/verify`

Repo evidence:

- [src/lib/matching/providers/compreface.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/matching/providers/compreface.ts)

### Recommended CompreFace deployment

Run CompreFace on the same VPS with Docker Compose.

Keep it internal-only:

- bind CompreFace UI/API to `127.0.0.1:8000`
- do not expose it publicly

### Docker Compose file

Create `/opt/compreface/docker-compose.yml`:

```yaml
version: "3.4"

volumes:
  postgres-data:

services:
  compreface-postgres-db:
    image: exadel/compreface-postgres-db:1.2.0
    restart: always
    container_name: compreface-postgres-db
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: frs
    volumes:
      - postgres-data:/var/lib/postgresql/data

  compreface-admin:
    image: exadel/compreface-admin:1.2.0
    restart: always
    container_name: compreface-admin
    depends_on:
      - compreface-postgres-db
      - compreface-api
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_URL: jdbc:postgresql://compreface-postgres-db:5432/frs
      SPRING_PROFILES_ACTIVE: dev
      ENABLE_EMAIL_SERVER: "false"
      EMAIL_HOST: smtp.gmail.com
      EMAIL_USERNAME: ""
      EMAIL_FROM: ""
      EMAIL_PASSWORD: ""
      ADMIN_JAVA_OPTS: -Xmx1g
      MAX_FILE_SIZE: 5MB
      MAX_REQUEST_SIZE: 10MB

  compreface-api:
    image: exadel/compreface-api:1.2.0
    restart: always
    container_name: compreface-api
    depends_on:
      - compreface-postgres-db
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_URL: jdbc:postgresql://compreface-postgres-db:5432/frs
      SPRING_PROFILES_ACTIVE: dev
      API_JAVA_OPTS: -Xmx4g
      SAVE_IMAGES_TO_DB: "true"
      MAX_FILE_SIZE: 5MB
      MAX_REQUEST_SIZE: 10MB
      CONNECTION_TIMEOUT: 10000
      READ_TIMEOUT: 60000

  compreface-fe:
    image: exadel/compreface-fe:1.2.0
    restart: always
    container_name: compreface-ui
    depends_on:
      - compreface-api
      - compreface-admin
    ports:
      - "127.0.0.1:8000:80"
    environment:
      CLIENT_MAX_BODY_SIZE: 10M
      PROXY_READ_TIMEOUT: 60000ms
      PROXY_CONNECT_TIMEOUT: 10000ms

  compreface-core:
    image: exadel/compreface-core:1.2.0
    restart: always
    container_name: compreface-core
    environment:
      ML_PORT: 3000
      IMG_LENGTH_LIMIT: 640
      UWSGI_PROCESSES: 2
      UWSGI_THREADS: 1
    healthcheck:
      test: curl --fail http://localhost:3000/healthcheck || exit 1
      interval: 10s
      retries: 0
      start_period: 0s
      timeout: 1s
```

Start it:

```bash
sudo mkdir -p /opt/compreface
cd /opt/compreface
sudo docker compose up -d
sudo docker compose ps
```

### Access CompreFace UI

Create an SSH tunnel from your local machine:

```bash
ssh -L 8000:127.0.0.1:8000 YOURUSER@YOUR_VPS_IP
```

Then open:

- `http://127.0.0.1:8000/login`

### Create the required CompreFace keys

Using the CompreFace UI:

1. Sign up and log in.
2. Create one application.
3. Inside that application, create one `DETECTION` service.
4. Copy its API key into `COMPREFACE_DETECTION_API_KEY`.
5. Inside the same application, create one `VERIFICATION` service.
6. Copy its API key into `COMPREFACE_VERIFICATION_API_KEY`.

Repo-specific mapping:

- detection/materialization calls use the detection key
- verify + embeddings verify use the verification key

## Background jobs / queue draining

### Matching

The repo queues matching work when:

- photos are finalized
- headshot-linked consent is submitted
- reconcile finds missing work

Repo evidence:

- post-finalize enqueue: [src/lib/assets/post-finalize-processing.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/assets/post-finalize-processing.ts)
- consent enqueue: [src/app/i/[token]/consent/route.ts](C:/Users/tim/projects/snapconsent-lite/src/app/i/[token]/consent/route.ts)
- reconcile: [src/lib/matching/auto-match-reconcile.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/matching/auto-match-reconcile.ts)

Required matching endpoints:

- `POST /api/internal/matching/worker`
- `POST /api/internal/matching/reconcile`

Optional matching endpoint:

- `POST /api/internal/matching/repair`

### Asset derivatives

The repo queues photo derivatives asynchronously for display:

- `thumbnail`
- `preview`

Repo evidence:

- derivative queueing: [src/lib/assets/asset-image-derivatives.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/assets/asset-image-derivatives.ts)
- derivative worker: [src/lib/assets/asset-image-derivative-worker.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/assets/asset-image-derivative-worker.ts)
- derivative repair: [src/lib/assets/asset-image-derivative-repair.ts](C:/Users/tim/projects/snapconsent-lite/src/lib/assets/asset-image-derivative-repair.ts)

Required asset endpoints:

- `POST /api/internal/assets/worker`
- `POST /api/internal/assets/repair`

### Headshot cleanup

Optional for this demo:

- `POST /api/internal/headshots/cleanup`

### Simplest demo scheduling

Use `systemd` timers.

Recommended frequency:

- matching worker: every 1 minute
- matching reconcile: every 10 minutes
- asset worker: every 1 minute
- asset repair: every 15 minutes

## Systemd worker and timer files

### Matching worker service

Create `/etc/systemd/system/snapconsent-matching-worker.service`:

```ini
[Unit]
Description=SnapConsent matching worker trigger
After=network.target snapconsent-lite.service
Requires=snapconsent-lite.service

[Service]
Type=oneshot
User=YOURUSER
WorkingDirectory=/home/YOURUSER/apps/snapconsent-lite
Environment=APP_URL=http://127.0.0.1:3000
EnvironmentFile=/home/YOURUSER/apps/snapconsent-lite/.env.local
ExecStart=/bin/sh -lc 'curl --fail --silent --show-error -X POST "$APP_URL/api/internal/matching/worker" -H "Authorization: Bearer $MATCHING_WORKER_TOKEN" -H "Content-Type: application/json" -d "{\"batchSize\":25}"'
```

### Matching worker timer

Create `/etc/systemd/system/snapconsent-matching-worker.timer`:

```ini
[Unit]
Description=Run SnapConsent matching worker every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
Persistent=true

[Install]
WantedBy=timers.target
```

### Matching reconcile service

Create `/etc/systemd/system/snapconsent-matching-reconcile.service`:

```ini
[Unit]
Description=SnapConsent matching reconcile trigger
After=network.target snapconsent-lite.service
Requires=snapconsent-lite.service

[Service]
Type=oneshot
User=YOURUSER
WorkingDirectory=/home/YOURUSER/apps/snapconsent-lite
Environment=APP_URL=http://127.0.0.1:3000
EnvironmentFile=/home/YOURUSER/apps/snapconsent-lite/.env.local
ExecStart=/bin/sh -lc 'curl --fail --silent --show-error -X POST "$APP_URL/api/internal/matching/reconcile" -H "Authorization: Bearer $MATCHING_RECONCILE_TOKEN" -H "Content-Type: application/json" -d "{\"lookbackMinutes\":180,\"batchSize\":150}"'
```

### Matching reconcile timer

Create `/etc/systemd/system/snapconsent-matching-reconcile.timer`:

```ini
[Unit]
Description=Run SnapConsent matching reconcile every 10 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=10min
Persistent=true

[Install]
WantedBy=timers.target
```

### Asset worker service

Create `/etc/systemd/system/snapconsent-asset-worker.service`:

```ini
[Unit]
Description=SnapConsent asset derivative worker trigger
After=network.target snapconsent-lite.service
Requires=snapconsent-lite.service

[Service]
Type=oneshot
User=YOURUSER
WorkingDirectory=/home/YOURUSER/apps/snapconsent-lite
Environment=APP_URL=http://127.0.0.1:3000
EnvironmentFile=/home/YOURUSER/apps/snapconsent-lite/.env.local
ExecStart=/bin/sh -lc 'curl --fail --silent --show-error -X POST "$APP_URL/api/internal/assets/worker" -H "Authorization: Bearer $ASSET_DERIVATIVE_WORKER_TOKEN" -H "Content-Type: application/json" -d "{\"batchSize\":25}"'
```

### Asset worker timer

Create `/etc/systemd/system/snapconsent-asset-worker.timer`:

```ini
[Unit]
Description=Run SnapConsent asset worker every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
Persistent=true

[Install]
WantedBy=timers.target
```

### Asset repair service

Create `/etc/systemd/system/snapconsent-asset-repair.service`:

```ini
[Unit]
Description=SnapConsent asset derivative repair trigger
After=network.target snapconsent-lite.service
Requires=snapconsent-lite.service

[Service]
Type=oneshot
User=YOURUSER
WorkingDirectory=/home/YOURUSER/apps/snapconsent-lite
Environment=APP_URL=http://127.0.0.1:3000
EnvironmentFile=/home/YOURUSER/apps/snapconsent-lite/.env.local
ExecStart=/bin/sh -lc 'curl --fail --silent --show-error -X POST "$APP_URL/api/internal/assets/repair" -H "Authorization: Bearer $ASSET_DERIVATIVE_REPAIR_TOKEN" -H "Content-Type: application/json" -d "{\"limit\":250}"'
```

### Asset repair timer

Create `/etc/systemd/system/snapconsent-asset-repair.timer`:

```ini
[Unit]
Description=Run SnapConsent asset repair every 15 minutes

[Timer]
OnBootSec=10min
OnUnitActiveSec=15min
Persistent=true

[Install]
WantedBy=timers.target
```

Enable timers:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now snapconsent-matching-worker.timer
sudo systemctl enable --now snapconsent-matching-reconcile.timer
sudo systemctl enable --now snapconsent-asset-worker.timer
sudo systemctl enable --now snapconsent-asset-repair.timer
sudo systemctl list-timers --all | grep snapconsent
```

## Demo checklist

- app boots on port 3000
- login works with the Supabase Auth user you created
- protected pages load
- tenant auto-bootstrap works
- project creation works
- invite creation works
- public invite page works
- Supabase Storage uploads work
- CompreFace UI is reachable through SSH tunnel
- CompreFace detection and verification keys are configured
- matching worker timer runs successfully
- asset worker timer runs successfully
- photo derivatives appear over time
- matching progress updates over time

## Sources used for external verification

- Supabase local/remote deployment flow: https://supabase.com/docs/guides/local-development/overview
- CompreFace README: https://raw.githubusercontent.com/exadel-inc/CompreFace/master/README.md
- CompreFace usage guide: https://raw.githubusercontent.com/exadel-inc/CompreFace/master/docs/How-to-Use-CompreFace.md
- CompreFace services/plugins: https://raw.githubusercontent.com/exadel-inc/CompreFace/master/docs/Face-services-and-plugins.md
- CompreFace REST API description: https://github.com/exadel-inc/CompreFace/blob/master/docs/Rest-API-description.md
- CompreFace official compose and defaults: https://raw.githubusercontent.com/exadel-inc/CompreFace/master/docker-compose.yml and https://raw.githubusercontent.com/exadel-inc/CompreFace/master/.env
