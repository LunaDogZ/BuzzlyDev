// KPI-7 round 3 — campaigns SELECT as viewer and editor, before and after the push.
//
// The round-3 migration replaces three campaigns write policies; this checks that
// what viewer and editor can READ is unchanged. Holds NO service_role key: the
// public anon key from the frontend .env plus the test accounts in
// .env.kpi7-round2.local. Records the count AND the exact visible ids, so
// "identical" means the same rows, not just the same number.
//
//   node scripts/kpi7-round3-campaigns-select.mjs <out.json>
//
// Expectation, hand-declared from the fixture design (CLAUDE.md rule 11): viewer
// and editor are members of the test workspace only, which holds exactly two
// campaigns (kpi7r3-seed with an ad account, kpi7r3-seed-noacct without).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readEnv = (p) => Object.fromEntries(
  readFileSync(p, 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }),
);
const fe = readEnv(resolve(ROOT, '.env'));
const fx = readEnv(resolve(ROOT, '.env.kpi7-round2.local'));
const URL_ = fe.VITE_SUPABASE_URL;
const ANON = fe.VITE_SUPABASE_ANON_KEY;
if (!URL_ || !ANON) throw new Error('frontend .env lacks VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
if (Object.values(fe).some((v) => v.includes('service_role'))) throw new Error('refusing: a service_role key is reachable from the probe env');

const EXPECTED_IDS = [fx.KPI7R3_TEST_CAMPAIGN_ID, fx.KPI7R3_TEST_CAMPAIGN_NOACCT_ID].sort();
if (EXPECTED_IDS.some((v) => !v)) throw new Error('round-3 seed ids missing — run the fixture setup first');

async function login(role) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: fx[`KPI7_${role.toUpperCase()}_EMAIL`], password: fx[`KPI7_${role.toUpperCase()}_PASSWORD`] }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${role}: ${r.status} ${JSON.stringify(j)}`);
  return j.access_token;
}

const out = { measured_at: new Date().toISOString(), expected_ids: EXPECTED_IDS, roles: {} };
for (const role of ['viewer', 'editor']) {
  const jwt = await login(role);
  const r = await fetch(`${URL_}/rest/v1/campaigns?select=id,team_id,ad_account_id,name&order=id`, {
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, Prefer: 'count=exact' },
  });
  const rows = await r.json();
  const ids = Array.isArray(rows) ? rows.map((x) => x.id).sort() : null;
  out.roles[role] = {
    status: r.status, content_range: r.headers.get('content-range'), count: ids?.length ?? null, ids,
    as_declared: JSON.stringify(ids) === JSON.stringify(EXPECTED_IDS),
  };
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + '\n');
for (const [role, r] of Object.entries(out.roles)) console.log(`${role}: HTTP ${r.status} count=${r.count} range=${r.content_range} as_declared=${r.as_declared}`);
