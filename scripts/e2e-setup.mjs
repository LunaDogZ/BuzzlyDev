// One-command e2e bootstrap: verifies env, seeds the e2e user + workspace,
// starts the mock-api on :3001 (if not already running), and ingests fixture data.
//
// Usage (from repo root):  npm run e2e:setup
// After it finishes:       npx playwright test e2e/visual-walk.spec.ts --project=chromium
//
// Idempotent: safe to re-run. Requires mock-api/.env with cloud SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY (see mock-api/.env.example) and a repo-root .env
// with the VITE_* keys (see .env.example) for the frontend itself.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MOCK_DIR = resolve(ROOT, 'mock-api');
const MOCK_API = process.env.RESEED_API_BASE || 'http://localhost:3001';

const ok = (msg) => console.log(`✓ ${msg}`);
const step = (msg) => console.log(`\n▶ ${msg}`);
const fail = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };

function parseEnvFile(path) {
  if (!existsSync(path)) return null;
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        let v = l.slice(i + 1).trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        return [l.slice(0, i).trim(), v];
      })
  );
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) fail(`${cmd} ${args.join(' ')} exited with ${r.status}`);
}

async function healthy() {
  try {
    const res = await fetch(`${MOCK_API}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// ── 1. Env preflight ────────────────────────────────────────────────────────
step('Checking env files');

const mockEnv = parseEnvFile(resolve(MOCK_DIR, '.env'));
if (!mockEnv) fail('mock-api/.env is missing. Copy mock-api/.env.example and fill in the cloud service_role key.');
if (!mockEnv.SUPABASE_URL || !mockEnv.SUPABASE_SERVICE_ROLE_KEY) {
  fail('mock-api/.env must set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (cloud project).');
}
ok(`mock-api/.env → ${mockEnv.SUPABASE_URL}`);

const feEnv = parseEnvFile(resolve(ROOT, '.env'));
if (!feEnv || !feEnv.VITE_SUPABASE_URL || !feEnv.VITE_SUPABASE_ANON_KEY) {
  console.warn('⚠ Repo-root .env is missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.');
  console.warn('  Seeding will still work, but the frontend (and the Playwright walk) cannot log in.');
  console.warn('  Copy .env.example → .env and follow its instructions.');
} else {
  ok(`.env → ${feEnv.VITE_SUPABASE_URL}`);
  if (feEnv.VITE_SUPABASE_URL.replace(/\/$/, '') !== mockEnv.SUPABASE_URL.replace(/\/$/, '')) {
    console.warn('⚠ .env VITE_SUPABASE_URL and mock-api/.env SUPABASE_URL point at DIFFERENT projects — the app will not see the seeded data.');
  }
}

// ── 2. mock-api dependencies ────────────────────────────────────────────────
if (!existsSync(resolve(MOCK_DIR, 'node_modules'))) {
  step('Installing mock-api dependencies (first run)');
  run('npm', ['install'], MOCK_DIR);
}

// ── 3. Seed e2e user + self-contained workspace (idempotent) ───────────────
step('Seeding e2e user + workspace (scripts/e2e-seed-workspace.mjs)');
run('node', [resolve(__dirname, 'e2e-seed-workspace.mjs')], ROOT);

// ── 4. Start mock-api on :3001 if not already up ────────────────────────────
step(`Checking mock-api at ${MOCK_API}`);
if (await healthy()) {
  ok('mock-api already running');
} else {
  console.log('Starting mock-api (tsx server.ts, logs → mock-api/server.log)...');
  const log = openSync(resolve(MOCK_DIR, 'server.log'), 'a');
  const child = spawn(resolve(MOCK_DIR, 'node_modules', '.bin', 'tsx'), ['server.ts'], {
    cwd: MOCK_DIR,
    detached: true,
    stdio: ['ignore', log, log],
  });
  child.unref();

  let up = false;
  for (let i = 0; i < 20 && !up; i++) {
    await new Promise((r) => setTimeout(r, 750));
    up = await healthy();
  }
  if (!up) fail('mock-api did not become healthy within 15s — check mock-api/server.log');
  ok(`mock-api up (pid ${child.pid})`);
}

// ── 5. Ingest fixture data into every mock-key connection ──────────────────
step('Ingesting fixture data (mock-api/scripts/reseed.mjs)');
run('node', [resolve(MOCK_DIR, 'scripts', 'reseed.mjs')], MOCK_DIR);

// ── Done ────────────────────────────────────────────────────────────────────
console.log(`
✅ e2e environment ready.
   e2e login : ${process.env.E2E_EMAIL || 'e2e@buzzly.test'} / ${process.env.E2E_PASSWORD || 'E2eWalk!2026'}
   mock-api  : ${MOCK_API} (leave running; stop with: kill $(lsof -ti:3001))

Next:
   npm run dev                                                      # app on :8080
   npx playwright test e2e/visual-walk.spec.ts --project=chromium   # screenshots → e2e/screenshots/
`);
