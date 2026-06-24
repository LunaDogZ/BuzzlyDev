# Buzzly (MVP)

Marketing data consolidation platform — React 18 + Vite 5 + TypeScript + Tailwind + shadcn + Supabase + TanStack Query. Customer dashboard for Facebook / Instagram / TikTok / Shopee / Google ad data.

## Run from zero

Prereqs: Node 22+, the [Supabase CLI](https://supabase.com/docs/guides/cli) (logged in), and **no `bun`**.

### 1. Frontend env (REQUIRED — the app cannot reach Supabase without it)

There is **no committed `.env`** (it is gitignored). Copy the template and fill in the Supabase values:

```bash
cp .env.example .env
```

This project runs in **mixed mode**: frontend local (port 8080) → Supabase **cloud**. So `.env` must point at the cloud project, not `127.0.0.1`:

```
VITE_SUPABASE_URL="https://<project-ref>.supabase.co"
VITE_SUPABASE_ANON_KEY="<anon JWT>"
VITE_BACKEND_API_URL="http://localhost:3001"
```

Get the cloud anon key (it is a public, RLS-protected key):

```bash
supabase projects api-keys --project-ref <project-ref>   # copy the `anon` row
```

### 2. Install + run

```bash
npm install
npm run dev          # http://localhost:8080
```

## Mock data (mock-api)

Platform integrations are **mock fixtures**, not real OAuth. The mock Express server ingests fixture data into Supabase.

```bash
cd mock-api
cp .env.example .env   # set SUPABASE_URL (cloud) + SUPABASE_SERVICE_ROLE_KEY
./node_modules/.bin/tsx server.ts          # serves :3001 (NOT watch — restart after edits)
node scripts/reseed.mjs                     # re-ingest fixtures into mock-key connections
node scripts/verify.mjs <teamId>            # dump campaigns / campaign_ads / ad_insights
```

## E2E visual walk

Authenticated Playwright walk of the customer pages, using a dedicated seeded account.

```bash
node scripts/e2e-seed-user.mjs        # create the e2e auth user
node scripts/e2e-seed-workspace.mjs   # its own workspace + mock connection + Team plan
(cd mock-api && node scripts/reseed.mjs)             # ingest data into the e2e workspace
npx playwright test e2e/visual-walk.spec.ts --project=chromium   # → e2e/screenshots/
```

Default credentials: `e2e@buzzly.test` / `E2eWalk!2026` (override with `E2E_EMAIL` / `E2E_PASSWORD`). The seed scripts read the cloud service_role key from `mock-api/.env`.

## Typecheck / build / test

```bash
npx tsc --noEmit -p tsconfig.app.json   # REAL typecheck (bare `tsc` checks nothing)
npm run build
npm test                                 # vitest (note: unit suite has known mock-setup debt)
```
