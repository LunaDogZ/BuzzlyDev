// KPI-7 round 3 — negative probes on production for the four functions that
// 20261007193000 gave a caller check. Holds NO service_role key: the public anon
// key from the frontend .env plus the test accounts in .env.kpi7-round2.local.
//
//   node scripts/kpi7-round3-function-probe.mjs <out.json>
//
// No active employee login exists, so the positive path for employees is NOT
// exercised here (it was tested on the local replica only). What is checked:
//   - anon and a signed-in non-employee customer (kpi7r2-editor) are refused by
//     evaluate_inactivity_tier_downgrades, sync_tier_from_lifetime_points and
//     update_tier_retention_period. The last one is called with a tier id that
//     does not exist, so even a failed guard could not write anything: it would
//     answer tier_not_found instead of employees_only.
//   - get_available_discounts returns nothing for another customer's id (asked by
//     the editor for the viewer's id, and by anon), and still answers for the
//     caller's own id (positive control: HTTP 200 with an array).
// Expectations are hand-declared below (CLAUDE.md rule 11).

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

const NO_SUCH_TIER = '00000000-0000-0000-0000-000000000000';
const VIEWER_ID = fx.KPI7_VIEWER_USER_ID;
const EDITOR_ID = fx.KPI7_EDITOR_USER_ID;

async function login(role) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: fx[`KPI7_${role}_EMAIL`], password: fx[`KPI7_${role}_PASSWORD`] }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${role}: ${r.status}`);
  return j.access_token;
}
async function rpc(jwt, fn, args) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

const callers = { anon: ANON, customer: await login('EDITOR') };
// [case, caller, fn, args, check(result) → true when the result is as declared]
const refusedWith = (msg) => (r) => r.status >= 400 && typeof r.body === 'object' && String(r.body.message ?? '').includes(msg);
const emptyArray = (r) => r.status === 200 && Array.isArray(r.body) && r.body.length === 0;
const CASES = [
  ['evaluate: anon refused', 'anon', 'evaluate_inactivity_tier_downgrades', {}, refusedWith('employees_only')],
  ['evaluate: customer refused', 'customer', 'evaluate_inactivity_tier_downgrades', {}, refusedWith('employees_only')],
  ['sync: anon refused', 'anon', 'sync_tier_from_lifetime_points', {}, refusedWith('employees only')],
  ['sync: customer refused', 'customer', 'sync_tier_from_lifetime_points', {}, refusedWith('employees only')],
  ['retention: anon refused', 'anon', 'update_tier_retention_period', { p_tier_id: NO_SUCH_TIER, p_retention_days: 60 }, refusedWith('employees_only')],
  ['retention: customer refused', 'customer', 'update_tier_retention_period', { p_tier_id: NO_SUCH_TIER, p_retention_days: 60 }, refusedWith('employees_only')],
  ["discounts: customer asks for another customer's id → empty", 'customer', 'get_available_discounts', { p_customer_id: VIEWER_ID }, emptyArray],
  ["discounts: anon asks for a customer's id → empty", 'anon', 'get_available_discounts', { p_customer_id: VIEWER_ID }, emptyArray],
  ['discounts: customer asks for own id → 200 array (positive control)', 'customer', 'get_available_discounts', { p_customer_id: EDITOR_ID }, (r) => r.status === 200 && Array.isArray(r.body)],
];

const out = { measured_at: new Date().toISOString(), cases: [] };
for (const [name, who, fn, args, check] of CASES) {
  const r = await rpc(callers[who], fn, args);
  const body = Array.isArray(r.body) ? { rows: r.body.length } : r.body;
  out.cases.push({ case: name, caller: who, fn, status: r.status, body, as_declared: check(r) });
}
out.summary = `${out.cases.filter((c) => c.as_declared).length}/${out.cases.length} as declared`;
writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + '\n');
for (const c of out.cases) console.log(`${c.as_declared ? 'OK  ' : 'FAIL'} ${c.case.padEnd(70)} HTTP ${c.status} ${JSON.stringify(c.body).slice(0, 90)}`);
console.log(out.summary);
