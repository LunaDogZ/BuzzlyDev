// KPI-7 round 3 — the nine SECURITY DEFINER functions whose EXECUTE was revoked by
// 20261007190000, called through PostgREST as anon and as a signed-in customer.
// Holds NO service_role key. Run it only after reading the live ACL (anon and
// authenticated must both lack EXECUTE): several of these functions write across
// tenants if they actually run. Arguments are NULLs, so even a call that ran
// would touch as little as possible.
//
//   node scripts/kpi7-round3-revoke-probe.mjs <out.json>
//
// Expected for every call (hand-declared): HTTP 401 (anon) / 403 (authenticated)
// with code 42501 "permission denied for function …".

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
if (Object.values(fe).some((v) => v.includes('service_role'))) throw new Error('refusing: a service_role key is reachable from the probe env');

const login = async (role) => {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email: fx[`KPI7_${role}_EMAIL`], password: fx[`KPI7_${role}_PASSWORD`] }) });
  const j = await r.json(); if (!j.access_token) throw new Error(`login ${role}: ${r.status}`); return j.access_token;
};
const CALLS = [
  ['process_scheduled_reports_with_preferences', {}],
  ['auto_stop_completed_campaigns', {}],
  ['create_weekly_digest_notifications', {}],
  ['debug_dashboard_visibility', {}],
  ['get_team_role', { _user_id: null, _team_id: null }],
  ['get_employee_role', { _user_id: null }],
  ['get_notification_preferences', { p_user_id: null }],
  ['increment_discount_usage', { d_id: null }],
  ['log_signup_trigger_error', { p_block: 'kpi7r3-probe', p_user_id: null, p_sqlstate: '00000', p_sqlerrm: 'kpi7r3 revoke probe' }],
];
const callers = { anon: ANON, customer: await login('EDITOR') };
const out = { measured_at: new Date().toISOString(), cases: [] };
for (const [fn, args] of CALLS) for (const [who, jwt] of Object.entries(callers)) {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  let body; const t = await r.text(); try { body = JSON.parse(t); } catch { body = t; }
  const code = body && typeof body === 'object' ? body.code : null;
  out.cases.push({ fn, caller: who, status: r.status, code, message: body?.message ?? null,
    as_declared: code === '42501' && r.status === (who === 'anon' ? 401 : 403) });
}
out.summary = `${out.cases.filter((c) => c.as_declared).length}/${out.cases.length} as declared`;
writeFileSync(process.argv[2], JSON.stringify(out, null, 2) + '\n');
for (const c of out.cases) console.log(`${c.as_declared ? 'OK  ' : 'FAIL'} ${c.fn.padEnd(44)} ${c.caller.padEnd(8)} HTTP ${c.status} ${c.code} ${c.message}`);
console.log(out.summary);
