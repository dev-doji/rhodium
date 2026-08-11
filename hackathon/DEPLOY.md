# Host the app on a real free provider (off ngrok)

The app is a **persistent, stateful server** (background reconciliation job +
in-memory mock chain). So use a **persistent host**, not serverless:

| Host | Free? | Fit | Notes |
|------|-------|-----|-------|
| **Render** (recommended) | ✅ free web service + free Postgres | ✅ runs as-is | spins down after ~15 min idle (~50s cold start) |
| Railway | ⚠️ trial credit | ✅ runs as-is | no spin-down; deploy from repo or `railway up` |
| Fly.io | ⚠️ needs a card | ✅ runs as-is | `fly launch` from this folder (Dockerfile) |
| Vercel / Cloudflare Workers | ✅ | ❌ serverless | breaks the background job + mock-chain state; needs rework |

Everything below is prepared: `render.yaml`, `Dockerfile`, `.dockerignore`,
`build:prod` / `start:prod`, and `PUBLIC_BASE_URL` auto-resolves from the host.

## Recommended: Render (from a GitHub repo)

### 1. Put the code on GitHub
```bash
git init && git add -A && git commit -m "Rhodium: WhatsApp commerce + Quai/BlipPay"
# create an empty repo on github.com, then:
git remote add origin git@github.com:<you>/rhodium.git
git push -u origin main
```
(`.env`, `node_modules`, build output are git-ignored — no secrets are pushed.)

### 2. Deploy the Blueprint
- Render → **New → Blueprint** → connect the repo. It reads `render.yaml` and
  provisions the **web service + a free Postgres**.
- Set the sensitive env vars (marked `sync:false`) in the Render dashboard:
  - `FIELD_ENCRYPTION_KEY` → run `openssl rand -hex 32`
  - `APP_SECRET` → any long random string
  - `WHATSAPP_ACCESS_TOKEN` → your 60-day token
  - `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`
- Deploy. Migrations run automatically (`prisma migrate deploy`). Health check: `/health`.

### 3. Point WhatsApp at it
Your app URL is `https://<name>.onrender.com`.
- Meta → WhatsApp → Configuration:
  - Callback URL: `https://<name>.onrender.com/webhooks/whatsapp`
  - Verify token: `rhodium-verify` → Verify and save → subscribe to **messages**.

### 4. Seed your merchant (against the hosted DB)
Copy the Render Postgres "External Database URL", then locally:
```bash
DATABASE_URL="postgresql://…render.com/…" npm run seed:merchant -- "+234YOURNUMBER" "Amaka Beauty" "0xYourQuaiWallet"
```
(or use the Render service **Shell** and run the same command there).

### 5. Test
Message your WhatsApp business number: `help` → `add Red Lipstick 5000` →
`sell <id> 1 +234BUYER crypto`. The checkout link is now
`https://<name>.onrender.com/checkout/<id>`; the traction board is
`https://<name>.onrender.com/traction`.

## Any Docker host (Railway / Fly / etc.)
```bash
# Fly example:
fly launch --no-deploy      # detects the Dockerfile
fly secrets set FIELD_ENCRYPTION_KEY=$(openssl rand -hex 32) APP_SECRET=... \
   WHATSAPP_ACCESS_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_APP_SECRET=...
fly deploy
```
Point `DATABASE_URL` at a hosted Postgres (Neon / Supabase / Render / Fly PG).

## Hosted Postgres options (the DB must leave your laptop)
- **Render Postgres** — provisioned by `render.yaml` automatically (simplest).
- **Neon** (neon.tech) — generous free tier, no card; paste its `DATABASE_URL`.
- **Supabase** — free Postgres; use the connection string (pooled for serverless).
